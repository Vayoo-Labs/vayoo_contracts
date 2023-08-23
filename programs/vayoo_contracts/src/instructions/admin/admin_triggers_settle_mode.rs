//libraries
use anchor_lang::prelude::*;
use switchboard_v2::AggregatorAccountData;

use crate::states::PriceFeed;
//local imports
use crate::states::contract_state::ContractState;

pub fn handle(ctx: Context<AdminTriggersSettleMode>,test_settlement_price: u64) -> Result<()> {
    let contract_state = &mut ctx.accounts.contract_state;
    contract_state.ending_price = test_settlement_price;

    contract_state.is_settling = true;
    contract_state.is_halted_deposit = true;
    contract_state.is_halted_trading = true;
    Ok(())
}

#[derive(Accounts)]
pub struct AdminTriggersSettleMode<'info> {
    pub contract_authority: Signer<'info>,
    #[account[
        mut,
        seeds = [contract_state.name.as_ref(), contract_state.lcontract_mint.as_ref(), contract_authority.key().as_ref()],
        bump,
        constraint = pyth_feed.key() == contract_state.oracle_feed_key || switchboard_feed.key() == contract_state.oracle_feed_key
    ]]
    pub contract_state: Box<Account<'info, ContractState>>,
    pub switchboard_feed: AccountLoader<'info, AggregatorAccountData>,
    pub pyth_feed: Account<'info, PriceFeed>,
}
