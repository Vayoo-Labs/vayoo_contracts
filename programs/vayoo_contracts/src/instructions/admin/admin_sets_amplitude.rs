//libraries
use anchor_lang::prelude::*;

//local imports
use crate::states::contract_state::ContractState;

pub fn handle(ctx: Context<AdminSetsAmplitude>,input_limiting_amplitude : u64) -> Result<()> {

    let contract_state_m = &mut ctx.accounts.contract_state;
    contract_state_m.limiting_amplitude=input_limiting_amplitude;
    Ok(())
}

#[derive(Accounts)]
pub struct AdminSetsAmplitude<'info> {
    // Super User
    #[account(mut)]
    pub contract_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [contract_state.name.as_bytes(), contract_state.lcontract_mint.key().as_ref(), contract_authority.key().as_ref()],
        bump,
        //has_one = escrow_vault_collateral
    )]
    pub contract_state: Box<Account<'info, ContractState>>,

    
}
