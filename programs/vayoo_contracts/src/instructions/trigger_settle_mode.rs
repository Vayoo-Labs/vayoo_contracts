//libraries
use anchor_lang::prelude::*;
use crate::errors::ErrorCode;

use crate::states::PriceFeed;
//local imports
use crate::states::contract_state::ContractState;

pub fn handle(ctx: Context<TriggerSettleMode>) -> Result<()> {
    let contract_state = &mut ctx.accounts.contract_state;
    let time_now = Clock::get()?.unix_timestamp;

    require!(
        !contract_state.is_settling,
        ErrorCode::AlreadySettled
    );

    if time_now as u64 > contract_state.ending_time {
        msg!("Settling Mode Triggered");

        let current_timestamp = Clock::get()?.unix_timestamp;
        let pyth_feed_price = ctx.accounts.pyth_feed
            .get_price_no_older_than(current_timestamp, 60)
            .ok_or(ErrorCode::PythOffline)?;
        msg!(&format!("Settling at  {}", pyth_feed_price.price) );
        contract_state.ending_price = pyth_feed_price.price as u64;

        contract_state.is_settling = true;
        contract_state.is_halted_deposit = true;
        contract_state.is_halted_trading = true;
        Ok(())
    } else {
        return err!(ErrorCode::MaturityNotReached);
    }
}

#[derive(Accounts)]
pub struct TriggerSettleMode<'info> {
    #[account[
        mut, 
        seeds = [contract_state.name.as_ref(), contract_state.lcontract_mint.as_ref(), contract_state.authority.as_ref()], 
        bump 
    ]]
    pub contract_state: Box<Account<'info, ContractState>>,
    pub pyth_feed: Account<'info, PriceFeed>,
}
