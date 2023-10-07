// libraries
use anchor_lang::prelude::*;

//local imports
pub mod constants;
pub mod errors;
pub mod instructions;
pub mod states;
pub mod utils;
pub mod types;

// crates
use crate::instructions::*;
use crate::utils::*;

#[cfg(feature="dev")]
declare_id!("G8mPtu5f87TaEipqSbYVtKtbdvZg19aBtCRuvJyogAqd");

#[cfg(feature="prod")]
declare_id!("6ccnZSaDcMwKe1xwHbubs4q2GdPEr7hSK59A3GddJpte");

#[program]
pub mod vayoo_contracts {

    use super::*;

    /**
     * Create global state account
     * This account holds all of the global platform variables
     *
     * Should only be called by the super owner
     */
    pub fn create_global_state(ctx: Context<CreateGlobalState>, bump: u8) -> Result<()> {
        create_global_state::handle(ctx, bump)
    }

    /**
     * Initialize/Create the contract
     *
     * Should only be called by the super owner
     */
    pub fn initialize_contract(
        ctx: Context<InitializeContract>,
        contract_name: String,
        bump: u8,
        ending_time: u64,
        limiting_amplitude: u64,
        feed_type: u8,
    ) -> Result<()> {
        initialize_contract::handle(ctx, contract_name, bump, ending_time, limiting_amplitude, feed_type)
    }

    /**
     * Initialize the User State Account for the contract
     *
     * Should only be called by the user whose state is getting initialised
     *
     * One state per contract
     */
    #[access_control(unrestricted_trading_phase(&ctx.accounts.contract_state))]
    pub fn initialize_user(ctx: Context<InitUser>, bump: u8) -> Result<()> {
        init_user_account::handle(ctx, bump)
    }

    /**
     * Deposit Collateral (USDC) from user -> vault
     */
    #[access_control(unrestricted_deposit_phase(&ctx.accounts.contract_state))]
    pub fn deposit_collateral(ctx: Context<DepositCollateral>, amount: u64) -> Result<()> {
        deposit_collateral::handle(ctx, amount)
    }

    /**
     * Withdraw Collateral (USDC) from vault -> user
     */
    pub fn withdraw_collateral(ctx: Context<WithdrawCollateral>, amount: u64) -> Result<()> {
        withdraw_collateral::handle(ctx, amount)
    }

    /**
     * Mint lcontract, for MM purposes
     *
     * This function takes in collateral
     * locks 2 * limiting amplitude * nb of tokens for minting - (free -> locked)
     * mints the required contracts
     */
    #[access_control(unrestricted_trading_phase(&ctx.accounts.contract_state))]
    pub fn mint_l_contract_mm(ctx: Context<MintContractMm>, amount: u64) -> Result<()> {
        mint_lcontract_mm::handle(ctx, amount)
    }

    /**
     * Burn lcontract, for MM purposes
     *
     * This function takes in lcontract,
     * unlocks 2 * limiting amplitude * nb of tokens for minting - (locked -> free)
     * burns the required contracts
     */
    #[access_control(unrestricted_trading_phase(&ctx.accounts.contract_state))]
    pub fn burn_l_contract_mm(ctx: Context<BurnContractMm>, amount: u64) -> Result<()> {
        burn_lcontract_mm::handle(ctx, amount)
    }

    /**
     * Long Contract
     */
    #[access_control(unrestricted_trading_phase(&ctx.accounts.contract_state))]
    pub fn long_user(
        ctx: Context<LongUser>,
        amount: u64,
        other_amount_threshold: u64,
        sqrt_price_limit: u128,
    ) -> Result<()> {
        long_user::handle(ctx, amount, other_amount_threshold, sqrt_price_limit)
    }

    /**
     * Close Long Contract
     */
    #[access_control(unrestricted_trading_phase(&ctx.accounts.contract_state))]
    pub fn close_long_user(
        ctx: Context<CloseLongUser>,
        amount: u64,
        other_amount_threshold: u64,
        sqrt_price_limit: u128,
    ) -> Result<()> {
        close_long_user::handle(ctx, amount, other_amount_threshold, sqrt_price_limit)
    }

    /**
     * Short Contract
     */
    #[access_control(unrestricted_trading_phase(&ctx.accounts.contract_state))]
    pub fn short_user(
        ctx: Context<ShortUser>,
        amount: u64,
        other_amount_threshold: u64,
        sqrt_price_limit: u128,
    ) -> Result<()> {
        short_user::handle(ctx, amount, other_amount_threshold, sqrt_price_limit)
    }

    /**
     * Close Short Contract
     */
    #[access_control(unrestricted_trading_phase(&ctx.accounts.contract_state))]
    pub fn close_short_user(
        ctx: Context<CloseShortUser>,
        amount: u64,
        other_amount_threshold: u64,
        sqrt_price_limit: u128,
    ) -> Result<()> {
        close_short_user::handle(ctx, amount, other_amount_threshold, sqrt_price_limit)
    }

    /**
     * Trigger Settle Mode
     *
     * Can be called by anyone, checks whether current time > maturity time.
     * If so, trigger settling mode on the contract state
     *
     */
    pub fn trigger_settle_mode(ctx: Context<TriggerSettleMode>) -> Result<()> {
        trigger_settle_mode::handle(ctx)
    }

    /**
     * Admin settle shorts and mm
     *
     * Can be called by superuser only (for now)
     *
     */
    pub fn admin_settle(ctx: Context<AdminSettle>) -> Result<()> {
        admin_settle::handle(ctx)
    }

    /**
     * User settle long
     *
     * Can be called by user only
     *
     */
    pub fn user_settle_long(ctx: Context<UserSettleLong>) -> Result<()> {
        user_settle_long::handle(ctx)
    }

    /**s
     * MM settle long
     *
     * Can be called by MM only
     *
     */
    pub fn mm_settle_long(ctx: Context<MmSettleLong>, amount: u64) -> Result<()> {
        mm_settle_long::handle(ctx, amount)
    }

    /**
     * Emergency withdraw
     *
     */
    pub fn emergency_withdraw(ctx: Context<EmergencyWithdraw>) -> Result<()> {
        emergency_withdraw::handle(ctx)
    }

    /**
     * Withdraw Collateral (USDC) from vault -> user
     */
     pub fn admin_sets_amplitude(ctx: Context<AdminSetsAmplitude>, amplitude_test: u64) -> Result<()> {
        admin_sets_amplitude::handle(ctx, amplitude_test)
    }

    pub fn admin_triggers_settle_mode(ctx: Context<AdminTriggersSettleMode>, test_settlement_price: u64) -> Result<()> {
        admin_triggers_settle_mode::handle(ctx, test_settlement_price)
    }
}
