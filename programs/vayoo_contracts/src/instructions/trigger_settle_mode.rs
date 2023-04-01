//libraries
use crate::errors::ErrorCode;
use crate::types::FeedType;
use anchor_lang::prelude::*;
use switchboard_v2::AggregatorAccountData;

use crate::states::PriceFeed;
//local imports
use crate::states::contract_state::ContractState;

pub fn handle(ctx: Context<TriggerSettleMode>) -> Result<()> {
    let contract_state = &mut ctx.accounts.contract_state;
    let time_now = Clock::get()?.unix_timestamp;

    require!(!contract_state.is_settling, ErrorCode::AlreadySettling);

    if time_now as u64 > contract_state.ending_time {
        msg!("Settling Mode Triggered");

        let current_timestamp = Clock::get()?.unix_timestamp;

        if contract_state.feed_type == FeedType::Pyth as u8 {
            // PYTH
            require!(
                contract_state.oracle_feed_key == ctx.accounts.pyth_feed.key(),
                ErrorCode::InvalidOraclefeed
            );
            let pyth_feed_price = ctx
                .accounts
                .pyth_feed
                .get_price_no_older_than(current_timestamp, 60)
                .ok_or(ErrorCode::PythOffline)?;
            msg!(
                "Pyth, Settling at price: {}, expo: {}",
                pyth_feed_price.price,
                pyth_feed_price.expo
            );

            contract_state.ending_price = pyth_feed_price.price as u64;
        } else if contract_state.feed_type == FeedType::Switchboard as u8 {
            // SWITCH_BOARD
            require!(
                contract_state.oracle_feed_key == ctx.accounts.switchboard_feed.key(),
                ErrorCode::InvalidOraclefeed
            );
            let switchboard_feed = &ctx.accounts.switchboard_feed.load()?;
            let switchboard_result = switchboard_feed.get_result()?;
            let expo = switchboard_result.scale;
            let price = switchboard_result.mantissa;

            // check whether the feed has been updated in the last 60 seconds
            switchboard_feed
                .check_staleness(Clock::get().unwrap().unix_timestamp, 60)
                .map_err(|_| error!(ErrorCode::StaleFeed))?;

            msg!("Switchboard, Settling at price: {}, expo: {}", price, expo);
            contract_state.ending_price = price as u64;
        }

        contract_state.is_settling = true;
        contract_state.is_halted_deposit = true;
        contract_state.is_halted_trading = true;
        Ok(())
    } else {
        err!(ErrorCode::MaturityNotReached)
    }
}

#[derive(Accounts)]
pub struct TriggerSettleMode<'info> {
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
