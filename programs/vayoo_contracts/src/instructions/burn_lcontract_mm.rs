//libraries
use crate::errors::ErrorCode;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};

//local imports
use crate::states::contract_state::ContractState;
use crate::states::user_state::UserState;

pub fn handle(ctx: Context<BurnContractMm>, amount: u64) -> Result<()> {
    //this function is to allow the market makers to mint the token -> be able to put it in the whirlpool and get liquidity
    //amount here represents the nb of tokens to mint
    //transfer collateral from the deposit account to the locked account
    //Then mint a long contract token
    //Amount he needs to lock = max value of the token = upperbound-lowerbound (in $)=2xcontract_limiting_bound_amplitude
    //Why ? because we assume the worst case scenario : the user mints the token , sell it on the whirlpool for 0 (looooser)
    //And after the token pumps and worths its max value -> we need to have that max value locked (+ the user is stupid and is a loser and cannot add capital -> we cannot assume he will be able to add capital in the sc after the minting)

    let amount_to_send = ctx
        .accounts
        .contract_state
        .limiting_amplitude
        .checked_mul(amount)
        .unwrap();

    let user_signer_seeds: &[&[&[u8]]] = &[&[
        ctx.accounts.user_state.contract_account.as_ref(),
        ctx.accounts.user_state.authority.as_ref(),
        &[ctx.accounts.user_state.bump],
    ]];

    let _contract_signer_seeds: &[&[&[u8]]] = &[&[
        ctx.accounts.contract_state.name.as_bytes(),
        ctx.accounts.contract_state.lcontract_mint.as_ref(),
        ctx.accounts.contract_state.authority.as_ref(),
        &[ctx.accounts.contract_state.bump],
    ]];

    let cpi_accounts = Transfer {
        from: ctx.accounts.vault_locked_collateral_ata.to_account_info(),
        to: ctx.accounts.vault_free_collateral_ata.to_account_info(),
        authority: ctx.accounts.user_state.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, user_signer_seeds);
    token::transfer(cpi_ctx, amount_to_send)?;

    //Burn lcontract
    let cpi_accounts = Burn {
        mint: ctx.accounts.lcontract_mint.to_account_info(),
        from: ctx.accounts.mm_lcontract_ata.to_account_info(),
        authority: ctx.accounts.user_authority.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    token::burn(cpi_ctx, amount)?;

    //Burn scontract
    let cpi_accounts = Burn {
        mint: ctx.accounts.scontract_mint.to_account_info(),
        from: ctx.accounts.mm_locked_scontract_ata.to_account_info(),
        authority: ctx.accounts.user_state.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, user_signer_seeds);
    token::burn(cpi_ctx, amount)?;

    let user_state = &mut ctx.accounts.user_state;

    // Update User State
    user_state.usdc_collateral_locked_as_mm -= amount_to_send;
    user_state.lcontract_minted_as_mm -= amount;
    user_state.contract_position_net = user_state.contract_position_net+(amount as i64) ;
    user_state.usdc_free = user_state.usdc_free+amount_to_send;

    
    // Update Contract State

    //Making sure the user vault is well collateralized
    let vault_final_scontract = ctx.accounts.mm_locked_scontract_ata.to_account_info();
    let vault_final_locked_usdc = ctx.accounts.vault_locked_collateral_ata.to_account_info();
    let vault_final_scontract_value = token::accessor::amount(&vault_final_scontract)?;
    let vault_final_locked_usdc_value = token::accessor::amount(&vault_final_locked_usdc)?;
    let needed_collateral = vault_final_scontract_value
        .checked_mul(ctx.accounts.contract_state.limiting_amplitude)
        .unwrap();
    if needed_collateral > vault_final_locked_usdc_value {
        return err!(ErrorCode::ShortLeaveUnhealthy);
    }
    let limit_amplitude_loc=ctx.accounts.contract_state.limiting_amplitude;
    let contract_state = &mut ctx.accounts.contract_state;
    contract_state.global_current_locked_usdc-= amount_to_send;
    contract_state.global_current_issued_lcontract-= amount;
    //Making sure the whole platform is well collateralized
    let global_final_issued_contract = contract_state.global_current_issued_lcontract;
    let global_needed_collateral = global_final_issued_contract
        .checked_mul(limit_amplitude_loc)
        .unwrap();
    if needed_collateral > contract_state.global_current_locked_usdc {
        return err!(ErrorCode::PlatformUnhealthy);
    }

    Ok(())
}

#[derive(Accounts)]
pub struct BurnContractMm<'info> {
    #[account(mut)]
    pub user_authority: Signer<'info>,

    #[account(
        mut,
        token::mint = contract_state.collateral_mint,
        token::authority = user_state
    )]
    pub vault_free_collateral_ata: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = contract_state.collateral_mint,
        token::authority = user_state
    )]
    pub vault_locked_collateral_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = lcontract_mint,
        token::authority = user_authority
    )]
    pub mm_lcontract_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = scontract_mint,
        token::authority = user_state
    )]
    pub mm_locked_scontract_ata: Box<Account<'info, TokenAccount>>,

    #[account[
        mut,
        seeds = [contract_state.name.as_ref(), contract_state.lcontract_mint.as_ref(), contract_state.authority.as_ref()],
        bump
    ]]
    pub contract_state: Box<Account<'info, ContractState>>,
    #[account(
        mut,
        seeds = [contract_state.key().as_ref(), user_authority.key().as_ref()],
        bump,
        constraint = user_authority.key() == user_state.authority @ ErrorCode::Unauthorized,
        constraint = user_state.contract_account == contract_state.key() @ErrorCode::Invalid
    )]
    pub user_state: Box<Account<'info, UserState>>,
    #[account(mut)]
    pub lcontract_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub scontract_mint: Box<Account<'info, Mint>>,
    pub collateral_mint: Box<Account<'info, Mint>>,
    // Programs and Sysvars
    pub token_program: Program<'info, Token>,
}
