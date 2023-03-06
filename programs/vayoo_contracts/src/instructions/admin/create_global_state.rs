// libraries
use anchor_lang::prelude::*;

use std::mem::size_of;
// local
use crate::{constants::*, states::global_state::GlobalState};

pub fn handle(ctx: Context<CreateGlobalState>, bump: u8) -> Result<()> {
    msg!("INITIALIZING GLOBAL STATE");

    let global_state = &mut ctx.accounts.global_state;

    global_state.bump = bump;
    global_state.authority = ctx.accounts.authority.key();
    global_state.paused = false;
    global_state.total_tvl_usdc = 0;

    Ok(())
}

#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct CreateGlobalState<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        seeds = [GLOBAL_STATE_SEED],
        bump,
        space = 8 + size_of::<GlobalState>()
    )]
    pub global_state: Box<Account<'info, GlobalState>>,

    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
