use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct ContractState {
    pub name: String, // 
    pub bump: u8,   // 1
    pub authority: Pubkey, // 32

    pub escrow_vault_collateral: Pubkey,

    pub is_halted:bool, //1
    pub is_halted_deposit:bool, //1
    pub is_halted_trading:bool, //1
    pub is_settling: bool,

    pub collateral_mint: Pubkey,       // 32
    pub lcontract_mint: Pubkey, // 32
    pub scontract_mint: Pubkey, // 32
    pub pyth_feed_id: Pubkey, //32

    pub limiting_amplitude: u64, // 32
    pub starting_price: u64, // 32
    pub starting_time: u64, // 32
    pub ending_price: u64, // 32
    pub ending_time: u64,

    pub cap_product: u64,
    pub current_tvl_usdc:u64,
    pub current_tvl_underlying:u64,

    pub reserved: [u64; 15],
}