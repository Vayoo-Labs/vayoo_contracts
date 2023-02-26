use anchor_lang::prelude::*;

use crate::errors::ErrorCode;
use crate::states::ContractState;

// Asserts the Contract is still accepting Deposit's
pub fn unrestricted_deposit_phase(contract_state: &ContractState) -> Result<()> {
    if contract_state.is_halted {
        return err!(ErrorCode::ContractHalted)
    }
    if contract_state.is_halted_deposit {
        return err!(ErrorCode::ContractDepositHalted);
    }
    let clock = Clock::get()?;
    if clock.unix_timestamp >= contract_state.contract_ending_time {
        return err!(ErrorCode::ContractEnded);
    }
    Ok(())
}

// Asserts the Contract is still accepting Deposit's
pub fn unrestricted_trading_phase(contract_state: &ContractState) -> Result<()> {
    if contract_state.is_halted {
        return err!(ErrorCode::ContractHalted)
    }
    if contract_state.is_halted_deposit {
        return err!(ErrorCode::ContractDepositHalted);
    }
    if contract_state.is_halted_trading {
        return err!(ErrorCode::ContractTradingHalted);
    }
    let clock = Clock::get()?;
    if clock.unix_timestamp >= contract_state.contract_ending_time {
        return err!(ErrorCode::ContractEnded);
    }
    Ok(())
}
