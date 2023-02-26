use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct ContractState {
    pub name: String, // 
    pub bump: u8,   // 1
    pub authority: Pubkey, // 32

    pub shared_redemption_pool: Pubkey, // 32

    pub is_halted:bool, //1
    pub is_halted_deposit:bool, //1
    pub is_halted_trading:bool, //1

    pub collateral_mint: Pubkey,       // 32
    pub underlying_mint: Pubkey, // 32
    pub pyth_feed_id: Pubkey, //32

    pub contract_limiting_bound_amplitude: u64, // 32
    pub contract_starting_price: i64, // 32
    pub contract_starting_time: i64, // 32
    pub contract_ending_price: i64, // 32
    pub contract_ending_time: i64,

    pub cap_product: u64,
    pub current_tvl_usdc:u64,
    pub current_tvl_underlying:u64,

    pub reserved: [u64; 15],
}