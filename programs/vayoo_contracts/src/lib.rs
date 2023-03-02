// libraries
use anchor_lang::prelude::*;

//local imports
pub mod constants;
pub mod errors;
pub mod instructions;
pub mod states;
pub mod utils;

// crates
use crate::instructions::*;
use crate::utils::*;

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
        ending_time: i64,
        limiting_amplitude: u64
    ) -> Result<()> {
        initialize_contract::handle(ctx, contract_name, bump, ending_time, limiting_amplitude)
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
    pub fn mint_l_contract_mm(
        ctx: Context<MintContractMm>,
        amount: u64
    ) -> Result<()> {
         mint_lcontract_mm::handle(ctx, amount)
    }

    /**
     * Burn lcontract, for MM purposes
     * 
     * This function takes in lcontract,
     * unlocks 2 * limiting amplitude * nb of tokens for minting - (locked -> free)
     * burns the required contracts
     */
    pub fn burn_l_contract_mm(
        ctx: Context<MintContractMm>,
        amount: u64
    ) -> Result<()> {
         mint_lcontract_mm::handle(ctx, amount)
    }

    /**
     * Long Contract
     */
    pub fn long_user(
        ctx: Context<LongUser>,
        amount: u64,
        other_amount_threshold: u64,
        sqrt_price_limit: u128,
        amount_specified_is_input: bool,
        a_to_b: bool,
    ) -> Result<()> {
        long_user::handle(ctx, amount, other_amount_threshold, sqrt_price_limit, amount_specified_is_input, a_to_b)
    }
}
