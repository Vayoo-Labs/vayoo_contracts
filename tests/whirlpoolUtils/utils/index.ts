import { PoolUtil, WhirlpoolContext } from "@orca-so/whirlpools-sdk";
import { AddressUtil } from "@orca-so/common-sdk";
import { createAndMintToAssociatedTokenAccount, createMint } from "./token";
import { Keypair, PublicKey } from "@solana/web3.js";

export const createInOrderMints = async (context: WhirlpoolContext) => {
    const provider = context.provider;
    const tokenXMintPubKey = await createMint(provider);
    await createAndMintToAssociatedTokenAccount(provider, tokenXMintPubKey, 1000000000000)
    const tokenYMintPubKey = await createMint(provider);
    await createAndMintToAssociatedTokenAccount(provider, tokenYMintPubKey, 1000000000000)
    return PoolUtil.orderMints(tokenXMintPubKey, tokenYMintPubKey).map(AddressUtil.toPubKey);
};

export const generateDefaultConfigParams = (
    context: WhirlpoolContext,
    funder?: PublicKey
  ) => {
    const configKeypairs = {
      feeAuthorityKeypair: Keypair.generate(),
      collectProtocolFeesAuthorityKeypair: Keypair.generate(),
      rewardEmissionsSuperAuthorityKeypair: Keypair.generate(),
    };
    const configInitInfo = {
      whirlpoolsConfigKeypair: Keypair.generate(),
      feeAuthority: configKeypairs.feeAuthorityKeypair.publicKey,
      collectProtocolFeesAuthority: configKeypairs.collectProtocolFeesAuthorityKeypair.publicKey,
      rewardEmissionsSuperAuthority: configKeypairs.rewardEmissionsSuperAuthorityKeypair.publicKey,
      defaultProtocolFeeRate: 300,
      funder: funder || context.wallet.publicKey,
    };
    return { configInitInfo, configKeypairs };
  };

  export function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }
  