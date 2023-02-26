// libraries
use anchor_lang::prelude::*;

//local imports
pub mod constants;
pub mod instructions;
pub mod states;
pub mod errors;
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
        ending_time: i64
    ) -> Result<()> {
        initialize_contract::handle(ctx, contract_name, bump, ending_time)
    }

    /**
     * Initialize the User State Account for the contract
     * 
     * Should only be called by the user whose state is getting initialised 
     * 
     * One state per contract
     */
    #[access_control(unrestricted_trading_phase(&ctx.accounts.contract_state))]
    pub fn initialize_user(
        ctx: Context<InitUser>,
        bump: u8
    ) -> Result<()> {
        init_user_account::handle(ctx, bump)
    }

    /**
     * Deposit Collateral (USDC) from user -> vault
     */
    #[access_control(unrestricted_deposit_phase(&ctx.accounts.contract_state))]
    pub fn deposit_collateral(
        ctx: Context<DepositCollateral>,
        amount: u64
    ) -> Result<()> {
        deposit_collateral::handle(ctx, amount)
    }

    /**
     * Withdraw Collateral (USDC) from vault -> user 
     */
    pub fn withdraw_collateral(
        ctx: Context<WithdrawCollateral>,
        amount: u64
    ) -> Result<()> {
        withdraw_collateral::handle(ctx, amount)
    }
}
