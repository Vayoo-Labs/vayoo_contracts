use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct ContractState {
    pub name: String,
    pub bump: u8,
    pub authority: Pubkey,

    pub escrow_vault_collateral: Pubkey,

    pub is_halted: bool,
    pub is_halted_deposit: bool,
    pub is_halted_trading: bool,
    pub is_settling: bool,

    pub collateral_mint: Pubkey,  
    pub lcontract_mint: Pubkey,   
    pub scontract_mint: Pubkey,     
    pub oracle_feed_type: u8,
    pub oracle_feed_key: Pubkey,   
    pub oracle_price_multiplier: u64,

    pub limiting_amplitude: u64, 
    pub starting_price: u64,   
    pub starting_time: u64,      
    pub ending_price: u64,       
    pub ending_time: u64,

    pub cap_product: u64,
    pub current_tvl_usdc: u64,
    pub current_tvl_underlying: u64,
    pub global_current_locked_usdc: u64,
    pub global_current_issued_lcontract: u64,

    pub test_mode: u64,
    pub bands_shift: u64, 
    pub vayoo_precisions:u8 ,

    pub reserved: [u64; 10],
}
