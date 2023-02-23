//libraries
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint};
use std::mem::size_of;

//local imports
use crate::states::{contract_state::ContractState, PriceFeed};
use crate::errors::ErrorCode;

pub fn handle(
    ctx: Context<InitializeContract>,
    contract_name: String,
    bump: u8,
) -> Result<()> {
    //[Medium] Initialize mint of the token
    msg!("INITIALIZING WEEKLY CONTRACT");

    let contract_state = &mut ctx.accounts.contract_state;
    let current_timestamp = Clock::get()?.unix_timestamp;

    // Contract Initialization
    contract_state.name = contract_name;
    contract_state.authority = ctx.accounts.contract_authority.key();
    contract_state.bump = bump;
    contract_state.is_halted = false;
    contract_state.underlying_mint = ctx.accounts.underlying_mint.key();

    //Get price from pyth and write it in the account
    contract_state.pyth_feed_id = ctx.accounts.pyth_feed.key();
    let pyth_feed_price = ctx.accounts.pyth_feed
            .get_price_no_older_than(current_timestamp, 60)
            .ok_or(ErrorCode::PythOffline)?;
    contract_state.contract_starting_price = pyth_feed_price.price;

    //Initialize other stuff
    contract_state.contract_starting_time = current_timestamp;
    Ok(())
}

#[derive(Accounts)]
#[instruction(contract_name: String, bumps: u8)]
pub struct InitializeContract<'info> {
    // Super User
    #[account(mut)]
    pub contract_authority: Signer<'info>,

    #[account(init,
        seeds = [contract_name.as_bytes(),underlying_mint.key().as_ref(), contract_authority.key().as_ref()],
        bump,
        payer = contract_authority,
        space = 8 + size_of::<ContractState>()
    )]
    pub contract_state: Box<Account<'info, ContractState>>,
    pub underlying_mint: Box<Account<'info, Mint>>,
    pub pyth_feed: Account<'info, PriceFeed>,

    // Programs and Sysvars
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
