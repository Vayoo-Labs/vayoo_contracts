import * as anchor from "@project-serum/anchor";
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import bs58 from 'bs58';
import { TickUtil, buildWhirlpoolClient, PriceMath, WhirlpoolContext, ORCA_WHIRLPOOL_PROGRAM_ID, increaseLiquidityQuoteByInputToken, PDAUtil, TICK_ARRAY_SIZE, TickArrayUtil, WhirlpoolIx, PoolUtil } from "@orca-so/whirlpools-sdk";
import Decimal from "decimal.js";
import { createInOrderMints } from "./utils";
import { ORCA_WHIRLPOOL_CONFIG_ID } from "./utils/constants";
import { WhirlpoolClient } from "@orca-so/whirlpools-sdk";
import { AddressUtil, Percentage } from "@orca-so/common-sdk";


export const createWhirlpool = async (whirlpoolCtx: WhirlpoolContext, wallet: anchor.Wallet, mintA: PublicKey, mintB: PublicKey, initialPrice: number) => {

  const connection = whirlpoolCtx.connection;
  const whirlpoolClient = buildWhirlpoolClient(whirlpoolCtx);
  const tickSpacing = 64; // Tick Spacing

  const initialTick = PriceMath.priceToInitializableTickIndex(new Decimal(initialPrice), 6, 6, tickSpacing)
  const [tokenAMintPubKey, tokenBMintPubKey] = PoolUtil.orderMints(mintA, mintB).map(AddressUtil.toPubKey);

  const { poolKey, tx } = await whirlpoolClient.createPool(
    ORCA_WHIRLPOOL_CONFIG_ID,
    tokenAMintPubKey,
    tokenBMintPubKey,
    tickSpacing,
    initialTick,
    wallet.publicKey
  );
  try {
    const txHash = await tx.addSigner(wallet.payer).buildAndExecute();
    await connection.confirmTransaction(txHash);
    return poolKey;
  }
  catch (e) {
    console.log(e);
  }

}

export const addLiquidity = async (whirlpoolCtx: WhirlpoolContext, poolKey: PublicKey, amount: number) => {

  // Load everything that you need
  const client = buildWhirlpoolClient(whirlpoolCtx);
  const pool = await client.getPool(poolKey);
  const poolData = pool.getData();
  const poolTokenAInfo = pool.getTokenAInfo();
  const poolTokenBInfo = pool.getTokenBInfo();

  // Derive the tick-indices based on a human-readable price
  const tokenADecimal = poolTokenAInfo.decimals;
  const tokenBDecimal = poolTokenBInfo.decimals;
  const tickLower = TickUtil.getInitializableTickIndex(
    PriceMath.priceToTickIndex(new Decimal(49), tokenADecimal, tokenBDecimal),
    poolData.tickSpacing
  );
  const tickUpper = TickUtil.getInitializableTickIndex(
    PriceMath.priceToTickIndex(new Decimal(51), tokenADecimal, tokenBDecimal),
    poolData.tickSpacing
  );

  // Get a quote on the estimated liquidity and tokenIn (50000 tokenA)
  const quote = increaseLiquidityQuoteByInputToken(
    poolTokenAInfo.mint,
    new Decimal(amount),
    tickLower,
    tickUpper,
    Percentage.fromFraction(1, 100),
    pool
  );

  // Initialize 2 tick array accounts for both directions
  let firstArrayStartTick = TickUtil.getStartTickIndex(poolData.tickCurrentIndex, poolData.tickSpacing);
  const secondArrayLongStartTick = firstArrayStartTick - (TICK_ARRAY_SIZE * poolData.tickSpacing);
  const secondArrayShortStartTick = firstArrayStartTick + (TICK_ARRAY_SIZE * poolData.tickSpacing);
  const thirdArrayLongStartTick = secondArrayLongStartTick - (TICK_ARRAY_SIZE * poolData.tickSpacing);
  const thirdArrayShortStartTick = secondArrayShortStartTick + (TICK_ARRAY_SIZE * poolData.tickSpacing);
  const tickArraysLong = TickArrayUtil.getTickArrayPDAs(poolData.tickCurrentIndex, poolData.tickSpacing, 3, whirlpoolCtx.program.programId, poolKey, true);
  const tickArraysShort = TickArrayUtil.getTickArrayPDAs(poolData.tickCurrentIndex, poolData.tickSpacing, 3, whirlpoolCtx.program.programId, poolKey, false);

  const ixSecondArrayLong =
    WhirlpoolIx.initTickArrayIx(whirlpoolCtx.program, {
      startTick: secondArrayLongStartTick,
      tickArrayPda: tickArraysLong[1],
      whirlpool: poolKey,
      funder: whirlpoolCtx.wallet.publicKey,
    })
  const ixThirdArrayLong =
    WhirlpoolIx.initTickArrayIx(whirlpoolCtx.program, {
      startTick: thirdArrayLongStartTick,
      tickArrayPda: tickArraysLong[2],
      whirlpool: poolKey,
      funder: whirlpoolCtx.wallet.publicKey,
    })
  const ixSecondArrayShort =
    WhirlpoolIx.initTickArrayIx(whirlpoolCtx.program, {
      startTick: secondArrayShortStartTick,
      tickArrayPda: tickArraysShort[1],
      whirlpool: poolKey,
      funder: whirlpoolCtx.wallet.publicKey,
    })
  const ixThirdArrayShort =
    WhirlpoolIx.initTickArrayIx(whirlpoolCtx.program, {
      startTick: thirdArrayShortStartTick,
      tickArrayPda: tickArraysShort[2],
      whirlpool: poolKey,
      funder: whirlpoolCtx.wallet.publicKey,
    })


  // Construct the open position & increase_liquidity ix and execute the transaction.
  try {
    const { positionMint, tx } = await pool.openPosition(
      tickLower,
      tickUpper,
      quote
    );
    tx.addInstructions([ixSecondArrayLong, ixSecondArrayShort, ixThirdArrayLong, ixThirdArrayShort]); // Add init tick array ix
    const txId = await tx.buildAndExecute();

    const position = await client.getPosition(
      PDAUtil.getPosition(whirlpoolCtx.program.programId, positionMint).publicKey
    )
    return position;
  } catch (e) {
    console.log(e);
  }
}