const express = require("express");
const router = express.Router();
const sql = require("mssql");
const { poolPromise } = require("../config/db");
const { authenticateToken } = require("../middleware/auth");

// Require auth token for all config routes
router.use(authenticateToken);

// ================= GET ALL CONFIGURATIONS =================
router.get("/", async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT 
        r.RuleId,
        r.CampaignId,
        r.PurchaseDishId,
        pd.Name AS PurchaseDishName,
        r.RewardDishId,
        rd.Name AS RewardDishName,
        r.RequiredBills,
        r.IsActive,
        c.Name AS CampaignName,
        c.StartDate,
        c.EndDate,
        r.CreatedOn
      FROM LoyaltyRule r
      INNER JOIN LoyaltyCampaign c ON r.CampaignId = c.CampaignId
      LEFT JOIN DishMaster pd ON r.PurchaseDishId = pd.DishId
      LEFT JOIN DishMaster rd ON r.RewardDishId = rd.DishId
      ORDER BY r.CreatedOn DESC
    `);
    res.json(result.recordset || []);
  } catch (err) {
    console.error("[LOYALTY CONFIG GET ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

// ================= SAVE / CREATE CONFIGURATION =================
router.post("/save", async (req, res) => {
  try {
    const { ruleId, campaignName, purchaseDishId, rewardDishId, requiredBills, isActive, startDate, endDate } = req.body;

    if (!campaignName || !purchaseDishId || !rewardDishId || !requiredBills) {
      return res.status(400).json({ error: "Missing required fields: campaignName, purchaseDishId, rewardDishId, requiredBills" });
    }

    const billsCount = parseInt(requiredBills);
    if (isNaN(billsCount) || billsCount <= 0) {
      return res.status(400).json({ error: "Required bills count must be a positive integer greater than zero." });
    }

    const pool = await poolPromise;
    const ruleActiveState = isActive === undefined ? 1 : (isActive ? 1 : 0);

    // 1. Validation: Verify dishes exist
    const dishCheck = await pool.request()
      .input("PurchaseId", sql.UniqueIdentifier, purchaseDishId)
      .input("RewardId", sql.UniqueIdentifier, rewardDishId)
      .query(`
        SELECT DishId FROM DishMaster WHERE DishId IN (@PurchaseId, @RewardId)
      `);
    
    if (dishCheck.recordset.length < (purchaseDishId === rewardDishId ? 1 : 2)) {
      return res.status(400).json({ error: "One or both selected dishes do not exist in DishMaster." });
    }

    // 2. Validation: Prevent duplicate active rules for same purchase dish
    if (ruleActiveState === 1) {
      const dupQuery = pool.request()
        .input("PurchaseId", sql.UniqueIdentifier, purchaseDishId);
      
      let dupSql = `
        SELECT RuleId FROM LoyaltyRule 
        WHERE PurchaseDishId = @PurchaseId AND IsActive = 1
      `;
      if (ruleId) {
        dupQuery.input("RuleId", sql.UniqueIdentifier, ruleId);
        dupSql += " AND RuleId <> @RuleId";
      }

      const dupRes = await dupQuery.query(dupSql);
      if (dupRes.recordset.length > 0) {
        return res.status(400).json({ error: "An active loyalty configuration already exists for this purchase dish." });
      }
    }

    const start = startDate ? new Date(startDate) : new Date();
    const end = endDate ? new Date(endDate) : new Date(new Date().setFullYear(new Date().getFullYear() + 10)); // Default 10 years out

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      if (ruleId) {
        // --- UPDATE ---
        // Fetch existing CampaignId
        const existingRule = await transaction.request()
          .input("RuleId", sql.UniqueIdentifier, ruleId)
          .query("SELECT CampaignId FROM LoyaltyRule WHERE RuleId = @RuleId");

        if (existingRule.recordset.length === 0) {
          throw new Error("Loyalty configuration not found.");
        }

        const campaignId = existingRule.recordset[0].CampaignId;

        // Update Campaign
        await transaction.request()
          .input("CampaignId", sql.UniqueIdentifier, campaignId)
          .input("Name", sql.NVarChar(100), campaignName.trim())
          .input("StartDate", sql.DateTime, start)
          .input("EndDate", sql.DateTime, end)
          .query(`
            UPDATE LoyaltyCampaign 
            SET Name = @Name, StartDate = @StartDate, EndDate = @EndDate
            WHERE CampaignId = @CampaignId
          `);

        // Update Rule
        await transaction.request()
          .input("RuleId", sql.UniqueIdentifier, ruleId)
          .input("PurchaseDishId", sql.UniqueIdentifier, purchaseDishId)
          .input("RewardDishId", sql.UniqueIdentifier, rewardDishId)
          .input("RequiredBills", sql.Int, billsCount)
          .input("IsActive", sql.Bit, ruleActiveState)
          .query(`
            UPDATE LoyaltyRule
            SET PurchaseDishId = @PurchaseDishId,
                RewardDishId = @RewardDishId,
                RequiredBills = @RequiredBills,
                IsActive = @IsActive
            WHERE RuleId = @RuleId
          `);
      } else {
        // --- INSERT ---
        const insertCampaignRes = await transaction.request()
          .input("Name", sql.NVarChar(100), campaignName.trim())
          .input("StartDate", sql.DateTime, start)
          .input("EndDate", sql.DateTime, end)
          .query(`
            DECLARE @campId UNIQUEIDENTIFIER = NEWID();
            INSERT INTO LoyaltyCampaign (CampaignId, Name, StartDate, EndDate, IsActive)
            VALUES (@campId, @Name, @StartDate, @EndDate, 1);
            SELECT @campId AS CampaignId;
          `);
        
        const campaignId = insertCampaignRes.recordset[0].CampaignId;

        await transaction.request()
          .input("CampaignId", sql.UniqueIdentifier, campaignId)
          .input("PurchaseDishId", sql.UniqueIdentifier, purchaseDishId)
          .input("RewardDishId", sql.UniqueIdentifier, rewardDishId)
          .input("RequiredBills", sql.Int, billsCount)
          .input("IsActive", sql.Bit, ruleActiveState)
          .query(`
            INSERT INTO LoyaltyRule (RuleId, CampaignId, PurchaseDishId, RewardDishId, RequiredBills, IsActive)
            VALUES (NEWID(), @CampaignId, @PurchaseDishId, @RewardDishId, @RequiredBills, @IsActive)
          `);
      }

      await transaction.commit();
      res.json({ success: true, message: "Loyalty configuration saved successfully." });
    } catch (txErr) {
      await transaction.rollback();
      throw txErr;
    }
  } catch (err) {
    console.error("[LOYALTY CONFIG SAVE ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

// ================= TOGGLE ACTIVE STATUS =================
router.patch("/:id/toggle", async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body; // boolean

    if (isActive === undefined) {
      return res.status(400).json({ error: "Missing required field: isActive" });
    }

    const pool = await poolPromise;
    const targetState = isActive ? 1 : 0;

    // If activating, verify no duplicates
    if (targetState === 1) {
      const currentRule = await pool.request()
        .input("RuleId", sql.UniqueIdentifier, id)
        .query("SELECT PurchaseDishId FROM LoyaltyRule WHERE RuleId = @RuleId");
      
      if (currentRule.recordset.length === 0) {
        return res.status(404).json({ error: "Loyalty configuration not found." });
      }

      const purchaseDishId = currentRule.recordset[0].PurchaseDishId;

      const dupCheck = await pool.request()
        .input("PurchaseId", sql.UniqueIdentifier, purchaseDishId)
        .input("RuleId", sql.UniqueIdentifier, id)
        .query(`
          SELECT RuleId FROM LoyaltyRule 
          WHERE PurchaseDishId = @PurchaseId AND IsActive = 1 AND RuleId <> @RuleId
        `);
      
      if (dupCheck.recordset.length > 0) {
        return res.status(400).json({ error: "An active loyalty configuration already exists for this purchase dish." });
      }
    }

    await pool.request()
      .input("RuleId", sql.UniqueIdentifier, id)
      .input("IsActive", sql.Bit, targetState)
      .query("UPDATE LoyaltyRule SET IsActive = @IsActive WHERE RuleId = @RuleId");

    res.json({ success: true, message: `Loyalty configuration successfully ${targetState === 1 ? "activated" : "deactivated"}.` });
  } catch (err) {
    console.error("[LOYALTY CONFIG TOGGLE ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

// ================= DELETE CONFIGURATION =================
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await poolPromise;

    // Fetch existing CampaignId to clean up both tables
    const existingRule = await pool.request()
      .input("RuleId", sql.UniqueIdentifier, id)
      .query("SELECT CampaignId FROM LoyaltyRule WHERE RuleId = @RuleId");

    if (existingRule.recordset.length === 0) {
      return res.status(404).json({ error: "Loyalty configuration not found." });
    }

    const campaignId = existingRule.recordset[0].CampaignId;

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      // 1. Delete rule first (foreign key dependency)
      await transaction.request()
        .input("RuleId", sql.UniqueIdentifier, id)
        .query("DELETE FROM LoyaltyRule WHERE RuleId = @RuleId");

      // 2. Delete campaign
      await transaction.request()
        .input("CampaignId", sql.UniqueIdentifier, campaignId)
        .query("DELETE FROM LoyaltyCampaign WHERE CampaignId = @CampaignId");

      await transaction.commit();
      res.json({ success: true, message: "Loyalty configuration deleted successfully." });
    } catch (txErr) {
      await transaction.rollback();
      throw txErr;
    }
  } catch (err) {
    console.error("[LOYALTY CONFIG DELETE ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
