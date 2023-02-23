//libraries
use anchor_lang::prelude::*;
use std::mem::size_of;

//local imports
use crate::states::contract_state::ContractState;
use crate::states::user_state::UserState;


pub fn handle(ctx: Context<InitUser>, _bump: u8) -> Result<()> {
    let user_state = &mut ctx.accounts.user_state;

    user_state.usdc_deposited = 0;
    user_state.usdc_withdrawn = 0;
    user_state.ishalted = false;
    user_state.issettled = false;
    user_state.authority = ctx.accounts.user_authority.key();
  
    Ok(())
  }

  #[derive(Accounts)]
  #[instruction(bump: u8)]
  pub struct InitUser<'info> {
      #[account(mut)]
      pub user_authority: Signer<'info>,
      #[account(init,
        seeds = [contract_state.key().as_ref(), user_authority.key().as_ref()],
        bump,
        payer = user_authority,
        space = 8 + size_of::<UserState>()
        )]
      pub user_state: Box<Account<'info, UserState>>,
  
      #[account[mut, 
            seeds = [contract_state.name.as_ref(), contract_state.underlying_mint.key().as_ref(), contract_state.authority.key().as_ref()], 
            bump 
        ]]
      pub contract_state: Box<Account<'info, ContractState>>,  
  
      pub system_program: Program<'info, System>,
      pub rent: Sysvar<'info, Rent>,
  }