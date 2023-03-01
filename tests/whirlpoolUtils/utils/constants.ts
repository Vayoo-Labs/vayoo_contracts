import * as anchor from "@project-serum/anchor";
import { u64 } from "@solana/spl-token";

export const ZERO_BN = new anchor.BN(0);

export const ONE_SOL = 1000000000;

export const MAX_U64 = new u64(new anchor.BN(2).pow(new anchor.BN(64)).sub(new anchor.BN(1)).toString());
export const ORCA_WHIRLPOOL_PROGRAM_ID = new anchor.web3.PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
export const ORCA_WHIRLPOOL_CONFIG_ID = new anchor.web3.PublicKey('2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ');
export const NEW_MINT_DECIMALS = 6;
