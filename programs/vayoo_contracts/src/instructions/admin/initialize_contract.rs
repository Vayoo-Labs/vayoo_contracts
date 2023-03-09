//libraries
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use std::mem::size_of;

//local imports
use crate::errors::ErrorCode;
use crate::states::{contract_state::ContractState, PriceFeed};

pub fn handle(
    ctx: Context<InitializeContract>,
    contract_name: String,
    bump: u8,
    ending_time: u64,
    limiting_amplitude: u64,
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
    contract_state.lcontract_mint = ctx.accounts.lcontract_mint.key();
    contract_state.scontract_mint = ctx.accounts.scontract_mint.key();
    contract_state.collateral_mint = ctx.accounts.collateral_mint.key();
    contract_state.escrow_vault_collateral = ctx.accounts.escrow_vault_collateral.key();

    //Get price from pyth and write it in the account
    contract_state.pyth_feed_id = ctx.accounts.pyth_feed.key();
    let pyth_feed_price = ctx
        .accounts
        .pyth_feed
        .get_price_no_older_than(current_timestamp, 60)
        .ok_or(ErrorCode::PythOffline)?;
    msg!(&format!("Initializing at  {}", pyth_feed_price.price));
    contract_state.starting_price = pyth_feed_price.price as u64;

    //Initialize other stuff
    contract_state.limiting_amplitude = limiting_amplitude;
    contract_state.starting_time = current_timestamp as u64;
    contract_state.ending_time = ending_time;
    contract_state.global_current_locked_usdc=0;
    contract_state.global_current_issued_lcontract=0;
    let mut multiplicator=(-pyth_feed_price.expo) as u32;
    let base=10 as u32;
    multiplicator=base.pow(multiplicator);
    contract_state.pyth_price_multiplier = multiplicator as u64;

    Ok(())
}

#[derive(Accounts)]
#[instruction(contract_name: String, bumps: u8)]
pub struct InitializeContract<'info> {
    // Super User
    #[account(mut)]
    pub contract_authority: Signer<'info>,

    #[account(init,
        seeds = [contract_name.as_bytes(),lcontract_mint.key().as_ref(), contract_authority.key().as_ref()],
        bump,
        payer = contract_authority,
        space = 8 + size_of::<ContractState>()
    )]
    pub contract_state: Box<Account<'info, ContractState>>,

    #[account(init,
        mint::decimals = 6,
        mint::authority = contract_state,
        seeds = [contract_name.as_bytes(), b"lcontract"],
        bump,
        payer = contract_authority
    )]
    pub lcontract_mint: Box<Account<'info, Mint>>,

    #[account(init,
        mint::decimals = 6,
        mint::authority = contract_state,
        seeds = [contract_name.as_bytes(), b"scontract"],
        bump,
        payer = contract_authority
    )]
    pub scontract_mint: Box<Account<'info, Mint>>,

    #[account(init,
        token::mint = collateral_mint,
        token::authority = contract_state,
        seeds = [
        b"escrow",
        collateral_mint.key().as_ref(),
        contract_state.key().as_ref(),
      ],
        bump,
        payer = contract_authority
      )]
    pub escrow_vault_collateral: Box<Account<'info, TokenAccount>>,

    pub collateral_mint: Box<Account<'info, Mint>>,

    pub pyth_feed: Account<'info, PriceFeed>,

    // Programs and Sysvars
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}
