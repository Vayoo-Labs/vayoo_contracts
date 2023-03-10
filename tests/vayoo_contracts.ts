import { DecimalUtil } from "@orca-so/common-sdk";
import { buildWhirlpoolClient, PDAUtil, PriceMath, SwapUtils, TickArrayUtil, WhirlpoolContext } from "@orca-so/whirlpools-sdk";
import * as anchor from "@project-serum/anchor";
import { Program, BN, web3 } from "@project-serum/anchor";
import { getAccount, getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token-v2";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Transaction } from "@solana/web3.js";
import { assert, expect } from "chai";
import { VayooContracts } from "../target/types/vayoo_contracts";
import { superUserKey, testUserKey } from "./testKeys";
import { sleep, toNativeAmount, toUiAmount } from "./utils";
import { GLOBAL_STATE_SEED, ONE_WEEK_IN_SECONDS, PYTH_FEED, USDC_DECIMALS } from "./utils/constants";
import { addLiquidity, createWhirlpool } from "./whirlpoolUtils";
import { ORCA_WHIRLPOOL_PROGRAM_ID } from "./whirlpoolUtils/utils/constants";
import { createAndMintToAssociatedTokenAccount, createMint } from "./whirlpoolUtils/utils/token";

const DEBUG_MODE = true; // If true, log useful info accross the tests on the console

describe("vayoo_contracts", () => {
  const provider = anchor.AnchorProvider.env();
  // anchor.setProvider(provider);
  const program = anchor.workspace.VayooContracts as Program<VayooContracts>;
  const connection = program.provider.connection;
  const whirlpoolCtx = WhirlpoolContext.withProvider(provider, ORCA_WHIRLPOOL_PROGRAM_ID);
  const whirlpoolClient = buildWhirlpoolClient(whirlpoolCtx);
  const superUser = superUserKey.keypair;
  const testUser = testUserKey.keypair;
  const testUserWallet = new anchor.Wallet(testUser);
  const pythFeed = new PublicKey(PYTH_FEED);
  let usdcMint: PublicKey;

  let accounts: any = {
    pythFeed,
    systemProgram: SystemProgram.programId,
    rent: SYSVAR_RENT_PUBKEY,
    tokenProgram: TOKEN_PROGRAM_ID
  }

  if (DEBUG_MODE) {
    console.log("Super User Key: ", superUser.publicKey.toString());
    console.log("Test User Key: ", testUser.publicKey.toString());
  }

  before("Setting up environment", async () => {
    const txHash = await connection.requestAirdrop(superUser.publicKey, LAMPORTS_PER_SOL * 10000);
    const txHash1 = await connection.requestAirdrop(testUser.publicKey, LAMPORTS_PER_SOL * 10000);
    await connection.confirmTransaction(txHash);
    await connection.confirmTransaction(txHash1);

    usdcMint = await createMint(provider);
    accounts.collateralMint = usdcMint

    if (DEBUG_MODE) console.log('Collateral Mint: ', usdcMint.toString());

    // mint usdc tokens to superUser and testUser
    await createAndMintToAssociatedTokenAccount(provider, accounts.collateralMint, toNativeAmount(1000000, USDC_DECIMALS), testUser.publicKey);
    await createAndMintToAssociatedTokenAccount(provider, accounts.collateralMint, toNativeAmount(1000000, USDC_DECIMALS), superUser.publicKey);
  })

  it("Create Global State", async () => {
    const [globalStateKey, globalStateKeyBump] = web3.PublicKey.findProgramAddressSync([Buffer.from(GLOBAL_STATE_SEED)], program.programId)
    accounts.globalState = globalStateKey

    await program.methods.createGlobalState(globalStateKeyBump).accounts({
      ...accounts,
      authority: superUser.publicKey
    }).signers([superUser]).rpc().catch((e) => { console.log(e) });;

    const globalStateAccount = await program.account.globalState.fetch(globalStateKey);
    DEBUG_MODE ? console.log("Global State Key: ", globalStateKey.toString()) : null;
    assert.ok(globalStateAccount.totalTvlUsdc.toNumber() == 0);
  });

  it("Initialize Contract Account/State", async () => {
    const contractName = "v0";
    const timeNow = Math.floor(Date.now() / 1000)
    // const contractEndTime = new BN(timeNow + ONE_WEEK_IN_SECONDS);
    const contractEndTime = new BN(timeNow + 5);
    const amplitude = new BN(30);

    const [scontractMint, scontractMintBump] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from(contractName), Buffer.from("scontract")],
        program.programId
      );
    const [lcontractMint, lcontractMintBump] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from(contractName), Buffer.from("lcontract")],
        program.programId
      );
    const [contractStateKey, contractStateKeyBump] = web3.PublicKey.findProgramAddressSync([Buffer.from(contractName), lcontractMint.toBuffer(), superUser.publicKey.toBuffer()], program.programId)
    const [escrowVaultCollateral, escrowVaultCollateralBump] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from('escrow'), accounts.collateralMint.toBuffer(), contractStateKey.toBuffer()],
        program.programId
      );
    accounts.escrowVaultCollateral = escrowVaultCollateral;
    accounts.contractState = contractStateKey;
    accounts.contractAuthority = superUser.publicKey;
    accounts.lcontractMint = lcontractMint;
    accounts.scontractMint = scontractMint;

    await program.methods.initializeContract(contractName, contractStateKeyBump, contractEndTime, amplitude).accounts({
      ...accounts
    }).signers([superUser]).rpc().catch((e) => { console.log(e) });;

    const contractStateAccount = await program.account.contractState.fetch(contractStateKey);
    if (DEBUG_MODE) {
      console.log("L Contract Mint Key: ", lcontractMint.toString())
      console.log("S Contract Mint Key: ", scontractMint.toString())
      console.log("Contract Starting Price: ", contractStateAccount.startingPrice.toString())
      console.log("Contract Expo: ", contractStateAccount.pythPriceMultiplier.toString())
    }

    assert.ok(contractStateAccount.isHalted == false);
    assert.ok(contractStateAccount.pythFeedId.equals(pythFeed));
  });

  it("Cannot Trigger Settle Mode - Maturity Not Reached", async () => {
    let msg = '';
    await program.methods.triggerSettleMode().accounts({ ...accounts }).rpc().catch((e) => (msg = e.error.errorCode.code));
    assert.ok(msg == 'MaturityNotReached');
  });

  it("Initialize User State for test user", async () => {
    const [userStateKey, userStateKeyBump] = web3.PublicKey.findProgramAddressSync([accounts.contractState.toBuffer(), testUser.publicKey.toBuffer()], program.programId)
    const [vaultFreeCollateralAta, vaultFreeCollateralAtaBump] = web3.PublicKey.findProgramAddressSync([Buffer.from("free"), userStateKey.toBuffer(), accounts.collateralMint.toBuffer()], program.programId);
    const [vaultLockedCollateralAta, vaultLockedCollateralAtaBump] = web3.PublicKey.findProgramAddressSync([Buffer.from("locked"), userStateKey.toBuffer(), accounts.collateralMint.toBuffer()], program.programId);
    const [vaultFreeScontractAta, vaultFreeScontractAtaBump] = web3.PublicKey.findProgramAddressSync([Buffer.from("free"), userStateKey.toBuffer(), accounts.scontractMint.toBuffer()], program.programId);
    const [vaultLockedScontractAta, vaultLockedScontractAtaBump] = web3.PublicKey.findProgramAddressSync([Buffer.from("locked"), userStateKey.toBuffer(), accounts.scontractMint.toBuffer()], program.programId);


    accounts.userState = userStateKey;
    accounts.userAuthority = testUser.publicKey;
    accounts.vaultFreeCollateralAta = vaultFreeCollateralAta;
    accounts.vaultLockedCollateralAta = vaultLockedCollateralAta;
    accounts.vaultFreeScontractAta = vaultFreeScontractAta;
    accounts.vaultLockedScontractAta = vaultLockedScontractAta;

    await program.methods.initializeUser(userStateKeyBump).accounts({
      ...accounts
    }).signers([testUser]).rpc().catch((e) => { console.log(e) });;

    const userStateAccount = await program.account.userState.fetch(userStateKey);
    DEBUG_MODE ? console.log("User State Key: ", userStateKey.toString()) : null;
    assert.ok(userStateAccount.usdcDeposited.toNumber() == 0);
  });

  it("Create ATAs for test user", async () => {
    // Test PDAs
    await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.lcontractMint, testUser.publicKey, true);
    await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.collateralMint, testUser.publicKey, true);
  });

  it("Deposit Collateral for test User", async () => {
    const userCollateralAtaBefore = await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.collateralMint, testUser.publicKey, true);
    const amountToDeposit = new BN(toNativeAmount(10000, USDC_DECIMALS));
    accounts.userCollateralAta = userCollateralAtaBefore.address;

    await program.methods.depositCollateral(amountToDeposit).accounts({
      ...accounts
    }).signers([testUser]).rpc().catch((e) => { console.log(e) });;
    const userUsdcAtaAfter = await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.collateralMint, testUser.publicKey, true);

    const userStateAccount = await program.account.userState.fetch(accounts.userState);
    assert.ok(userStateAccount.usdcDeposited.eq(amountToDeposit));
    assert.ok(Number(userCollateralAtaBefore.amount - userUsdcAtaAfter.amount) == amountToDeposit.toNumber())
  });

  it("Mint lcontract as mm", async () => {
    const mmLcontractAta = await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.lcontractMint, testUser.publicKey, true);

    const amountToMint = new BN(toNativeAmount(100, USDC_DECIMALS));
    accounts.mmLcontractAta = mmLcontractAta.address
    accounts.mmLockedScontractAta = accounts.vaultLockedScontractAta

    await program.methods.mintLContractMm(amountToMint).accounts({
      ...accounts
    }).signers([testUser]).rpc().catch((e) => { console.log(e) });;

    const userStateAccount = await program.account.userState.fetch(accounts.userState);
    assert.ok(userStateAccount.lcontractMintedAsMm.eq(amountToMint));
    if (DEBUG_MODE) {
      const mmLcontractAta = await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.lcontractMint, testUser.publicKey, true);
      console.log("MM LContract Balance :", mmLcontractAta.amount.toString());
    }
  });

  it("Burn lcontract as mm", async () => {
    const userStateAccountBefore = await program.account.userState.fetch(accounts.userState);
    const amountToBurn = new BN(toNativeAmount(50, USDC_DECIMALS));

    await program.methods.burnLContractMm(amountToBurn).accounts({
      ...accounts
    }).signers([testUser]).rpc().catch((e) => { console.log(e) });;

    const userStateAccountAfter = await program.account.userState.fetch(accounts.userState);
    assert.ok(userStateAccountBefore.lcontractMintedAsMm.sub(userStateAccountAfter.lcontractMintedAsMm).eq(amountToBurn));
    if (DEBUG_MODE) {
      const mmLcontractAta = await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.lcontractMint, testUser.publicKey, true);
      console.log("MM LContract Balance :", mmLcontractAta.amount.toString());
    }
  });

  it("Deploy whirlpool (lcontract / collateral ) + Add liquidity", async () => {
    const userlxAtaBefore = await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.lcontractMint, testUser.publicKey, true);
    const userColAtaBefore = await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.collateralMint, testUser.publicKey, true);

    let addLiquidityAmount = 10; // amount in lcontract nb
    const initial_price = 15; // initial price of the pool
    const spread = 0.01; // liquidity spread

    const whirlpoolKey = await createWhirlpool(whirlpoolCtx, testUserWallet, accounts.lcontractMint, accounts.collateralMint, initial_price);
    accounts.whirlpoolKey = whirlpoolKey;

    const poolData = (await whirlpoolClient.getPool(whirlpoolKey)).getData();
    const poolPrice = PriceMath.sqrtPriceX64ToPrice(poolData.sqrtPrice, 6, 6)
    if (DEBUG_MODE) {
      console.log("Pool Key: ", whirlpoolKey.toString());
      console.log("Pool Price: ", poolPrice.toFixed(2));
      console.log('Token A is LContract', poolData.tokenMintA.equals(accounts.lcontractMint))
    }

    const positionData = (await addLiquidity(whirlpoolCtx, whirlpoolKey, addLiquidityAmount, accounts.lcontractMint, spread)).getData();

    const userlxAtaAfter = await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.lcontractMint, testUser.publicKey, true);
    const userColAtaAfter = await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.collateralMint, testUser.publicKey, true);

    if (DEBUG_MODE) {
      console.log('Pool Mint A: ', poolData.tokenMintA.toString());
      console.log('Pool Mint B: ', poolData.tokenMintB.toString());
      console.log("Diff lcontract:", Number(userlxAtaAfter.amount - userlxAtaBefore.amount) / 1e6);
      console.log("Diff collateral:", Number(userColAtaAfter.amount - userColAtaBefore.amount) / 1e6);
    }
    assert.ok(positionData.liquidity.toNumber() > 0);
  });

  it("Withdraw Collateral for test User", async () => {
    const userCollateralAtaBefore = await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.collateralMint, testUser.publicKey, true);
    const amountToWithdraw = new BN(toNativeAmount(100, USDC_DECIMALS));

    await program.methods.withdrawCollateral(amountToWithdraw).accounts({
      ...accounts
    }).signers([testUser]).rpc().catch((e) => { console.log(e) });;

    const userUsdcAtaAfter = await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.collateralMint, testUser.publicKey, true);
    assert.ok(Number(userUsdcAtaAfter.amount - userCollateralAtaBefore.amount) == amountToWithdraw.toNumber())
  });

  it("Cannot create user state - Contract Ended", async () => {
    let msg = '';
    const contractName = "v1";
    const timeNow = Math.floor(Date.now() / 1000);
    const contractEndTime = new BN(timeNow + 3); // 3 seconds into the future
    const amplitude = new BN(30);

    const [scontractMint, scontractMintBump] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from(contractName), Buffer.from("scontract")],
        program.programId
      );
    const [lcontractMint, lcontractMintBump] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from(contractName), Buffer.from("lcontract")],
        program.programId
      );
    const [contractStateKey, contractStateKeyBump] = web3.PublicKey.findProgramAddressSync([Buffer.from(contractName), lcontractMint.toBuffer(), superUser.publicKey.toBuffer()], program.programId)
    const [escrowVaultCollateral, escrowVaultCollateralBump] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from('escrow'), accounts.collateralMint.toBuffer(), contractStateKey.toBuffer()],
        program.programId
      );

    // init contract with 3 second to the expiry
    await program.methods.initializeContract(contractName, contractStateKeyBump, contractEndTime, amplitude).accounts({
      ...accounts,
      contractState: contractStateKey,
      lcontractMint: lcontractMint,
      scontractMint: scontractMint,
      escrowVaultCollateral: escrowVaultCollateral
    }).signers([superUser]).rpc();

    // delay by 4 seconds
    await sleep(4);

    // try to create user state
    const [userStateKey, userStateKeyBump] = web3.PublicKey.findProgramAddressSync([contractStateKey.toBuffer(), testUser.publicKey.toBuffer()], program.programId)
    const [vaultFreeCollateralAta, vaultFreeCollateralAtaBump] = web3.PublicKey.findProgramAddressSync([Buffer.from("free"), userStateKey.toBuffer(), accounts.collateralMint.toBuffer()], program.programId);
    const [vaultLockedCollateralAta, vaultLockedCollateralAtaBump] = web3.PublicKey.findProgramAddressSync([Buffer.from("locked"), userStateKey.toBuffer(), accounts.collateralMint.toBuffer()], program.programId);
    const [vaultFreeScontractAta, vaultFreeScontractAtaBump] = web3.PublicKey.findProgramAddressSync([Buffer.from("free"), userStateKey.toBuffer(), accounts.scontractMint.toBuffer()], program.programId);
    const [vaultLockedScontractAta, vaultLockedScontractAtaBump] = web3.PublicKey.findProgramAddressSync([Buffer.from("locked"), userStateKey.toBuffer(), accounts.scontractMint.toBuffer()], program.programId);

    await program.methods.initializeUser(userStateKeyBump).accounts({
      ...accounts,
      userState: userStateKey,
      contractState: contractStateKey,
      vaultFreeCollateralAta,
      vaultLockedCollateralAta,
      vaultFreeScontractAta,
      vaultLockedScontractAta,
    }).signers([testUser]).rpc().catch((e) => (msg = e.error.errorCode.code));
    assert.ok(msg == 'ContractEnded')
  });

  it("Cannot deposit - Contract Ended", async () => {
    let msg = '';
    const contractName = "v2";
    const timeNow = Math.floor(Date.now() / 1000);
    const contractEndTime = new BN(timeNow + 4); // 4 seconds into the future
    const amplitude = new BN(30);

    const [scontractMint, scontractMintBump] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from(contractName), Buffer.from("scontract")],
        program.programId
      );
    const [lcontractMint, lcontractMintBump] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from(contractName), Buffer.from("lcontract")],
        program.programId
      );
    const [contractStateKey, contractStateKeyBump] = web3.PublicKey.findProgramAddressSync([Buffer.from(contractName), lcontractMint.toBuffer(), superUser.publicKey.toBuffer()], program.programId)
    const [escrowVaultCollateral, escrowVaultCollateralBump] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from('escrow'), accounts.collateralMint.toBuffer(), contractStateKey.toBuffer()],
        program.programId
      );

    // init contract with 4 second to the expiry
    await program.methods.initializeContract(contractName, contractStateKeyBump, contractEndTime, amplitude).accounts({
      ...accounts,
      contractState: contractStateKey,
      lcontractMint,
      scontractMint,
      escrowVaultCollateral,
    }).signers([superUser]).rpc();

    // create user state
    const [userStateKey, userStateKeyBump] = web3.PublicKey.findProgramAddressSync([contractStateKey.toBuffer(), testUser.publicKey.toBuffer()], program.programId);
    const [vaultFreeCollateralAta, vaultFreeCollateralAtaBump] = web3.PublicKey.findProgramAddressSync([Buffer.from("free"), userStateKey.toBuffer(), accounts.collateralMint.toBuffer()], program.programId);
    const [vaultLockedCollateralAta, vaultLockedCollateralAtaBump] = web3.PublicKey.findProgramAddressSync([Buffer.from("locked"), userStateKey.toBuffer(), accounts.collateralMint.toBuffer()], program.programId);

    const [vaultFreeScontractAta, vaultFreeScontractAtaBump] = web3.PublicKey.findProgramAddressSync([Buffer.from("free"), userStateKey.toBuffer(), accounts.scontractMint.toBuffer()], program.programId);
    const [vaultLockedScontractAta, vaultLockedScontractAtaBump] = web3.PublicKey.findProgramAddressSync([Buffer.from("locked"), userStateKey.toBuffer(), accounts.scontractMint.toBuffer()], program.programId);

    await program.methods.initializeUser(userStateKeyBump).accounts({
      ...accounts,
      userState: userStateKey,
      contractState: contractStateKey,
      vaultFreeCollateralAta,
      vaultLockedCollateralAta,
      vaultFreeScontractAta,
      vaultLockedScontractAta,
    }).signers([testUser]).rpc();

    // delay by 5 seconds
    await sleep(5);

    const amountToDeposit = new BN(toNativeAmount(0.02, USDC_DECIMALS));

    await program.methods.depositCollateral(amountToDeposit).accounts({
      ...accounts,
      userState: userStateKey,
      contractState: contractStateKey,
      vaultFreeCollateralAta
    }).signers([testUser]).rpc().catch((e) => (msg = e.error.errorCode.code));
    assert.ok(msg == 'ContractEnded')
  });

  it("Short Contract ", async () => {
    // Getting all accounts for the swap
    const poolKey = accounts.whirlpoolKey;
    const poolData = (await whirlpoolClient.getPool(poolKey)).getData();
    const vaultLcontractAtaBefore = await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.lcontractMint, accounts.userState, true);
    const vaultScontractAtaBefore = await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.scontractMint, accounts.userState, true);
    const vaultFreeCollateralAtaBefore = await getAccount(connection, accounts.vaultFreeCollateralAta)
    const vaultLockedCollateralAtaBefore = await getAccount(connection, accounts.vaultLockedCollateralAta)
    const whirlpool_oracle_pubkey = PDAUtil.getOracle(whirlpoolCtx.program.programId, poolKey).publicKey;

    // Arguments for swap
    const userStateAccount = await program.account.userState.fetch(accounts.userState);
    const amountToClose = userStateAccount.lcontractBoughtAsUser

    const a_input = DecimalUtil.toU64(DecimalUtil.fromNumber(1), 6); // open short
    const amount = new anchor.BN(a_input);
    const other_amount_threshold = new anchor.BN(0);
    const amount_specified_is_input = true;

    // Conditional Swap Direction, Super Important
    const a_to_b = !poolData.tokenMintA.equals(accounts.collateralMint);
    const sqrt_price_limit = SwapUtils.getDefaultSqrtPriceLimit(a_to_b);
    const tickArrays = TickArrayUtil.getTickArrayPDAs(poolData.tickCurrentIndex, poolData.tickSpacing, 3, whirlpoolCtx.program.programId, poolKey, a_to_b);

    await program.methods
      .shortUser(
        amount,
        other_amount_threshold,
        sqrt_price_limit,
        amount_specified_is_input,
        a_to_b,
      )
      .accounts({
        ...accounts,
        whirlpoolProgram: whirlpoolCtx.program.programId,
        whirlpool: poolKey,
        tokenVaultA: poolData.tokenVaultA,
        tokenVaultB: poolData.tokenVaultB,
        tickArray0: tickArrays[0].publicKey,
        tickArray1: tickArrays[1].publicKey,
        tickArray2: tickArrays[2].publicKey,
        oracle: whirlpool_oracle_pubkey,
        vaultLcontractAta: vaultLcontractAtaBefore.address,
        vaultScontractAta: vaultScontractAtaBefore.address,
      })
      .rpc().catch((e) => { console.log(e) });
    const vaultLcontractAtaAfter = await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.lcontractMint, accounts.userState, true);
    const vaultScontractAtaAfter = await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.scontractMint, accounts.userState, true);
    const collateral_after = await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.collateralMint, testUser.publicKey, true);
    const vaultFreeCollateralAtaAfter = await getAccount(connection, accounts.vaultFreeCollateralAta)
    const vaultLockedCollateralAtaAfter = await getAccount(connection, accounts.vaultLockedCollateralAta)


    if (DEBUG_MODE) {
      console.log('No of scontract :', Number(vaultScontractAtaAfter.amount - vaultScontractAtaBefore.amount) / 1e6)
      console.log('Free acc change :', Number(vaultFreeCollateralAtaAfter.amount - vaultFreeCollateralAtaBefore.amount) / 1e6)
      console.log('Locked acc change :', Number(vaultLockedCollateralAtaAfter.amount - vaultLockedCollateralAtaBefore.amount) / 1e6)
    }
  });

  it("Close Short Contract ", async () => {
    // Getting all accounts for the swap
    const poolKey = accounts.whirlpoolKey;
    const poolData = (await whirlpoolClient.getPool(poolKey)).getData();
    const vaultLcontractAtaBefore = await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.lcontractMint, accounts.userState, true);
    const whirlpool_oracle_pubkey = PDAUtil.getOracle(whirlpoolCtx.program.programId, poolKey).publicKey;
    const vaultScontractAtaBefore = await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.scontractMint, accounts.userState, true);
    const vaultFreeCollateralAtaBefore = await getAccount(connection, accounts.vaultFreeCollateralAta)
    const vaultLockedCollateralAtaBefore = await getAccount(connection, accounts.vaultLockedCollateralAta)

    // Arguments for swap
    const a_input = DecimalUtil.toU64(DecimalUtil.fromNumber(14), 6);
    const amount = new anchor.BN(a_input);
    const other_amount_threshold = new anchor.BN(0);
    const amount_specified_is_input = true;

    // Conditional Swap Direction, Super Important
    const a_to_b = poolData.tokenMintA.equals(accounts.collateralMint);
    const sqrt_price_limit = SwapUtils.getDefaultSqrtPriceLimit(a_to_b);
    const tickArrays = TickArrayUtil.getTickArrayPDAs(poolData.tickCurrentIndex, poolData.tickSpacing, 3, whirlpoolCtx.program.programId, poolKey, a_to_b);

    await program.methods
      .closeShortUser(
        amount,
        other_amount_threshold,
        sqrt_price_limit,
        amount_specified_is_input,
        a_to_b,
      )
      .accounts({
        ...accounts,
        whirlpoolProgram: whirlpoolCtx.program.programId,
        whirlpool: poolKey,
        tokenVaultA: poolData.tokenVaultA,
        tokenVaultB: poolData.tokenVaultB,
        tickArray0: tickArrays[0].publicKey,
        tickArray1: tickArrays[1].publicKey,
        tickArray2: tickArrays[2].publicKey,
        oracle: whirlpool_oracle_pubkey,
        vaultLcontractAta: vaultLcontractAtaBefore.address,
        vaultScontractAta: vaultScontractAtaBefore.address,
      })
      .rpc().catch((e) => { console.log(e) });
    const vaultScontractAtaAfter = await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.scontractMint, accounts.userState, true);

    const vaultFreeCollateralAtaAfter = await getAccount(connection, accounts.vaultFreeCollateralAta)
    const vaultLockedCollateralAtaAfter = await getAccount(connection, accounts.vaultLockedCollateralAta)

    const vaultLcontractAtaAfter = await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.lcontractMint, accounts.userState, true);
    if (DEBUG_MODE) {

      console.log('No of scontract :', Number(vaultScontractAtaAfter.amount - vaultScontractAtaBefore.amount) / 1e6)
      console.log('Free acc change :', Number(vaultFreeCollateralAtaAfter.amount - vaultFreeCollateralAtaBefore.amount) / 1e6)
      console.log('Locked acc change :', Number(vaultLockedCollateralAtaAfter.amount - vaultLockedCollateralAtaBefore.amount) / 1e6)

    }
  });


  it("Long Contract - test User", async () => {
    // Getting all accounts for the swap
    const userStateAccountBefore = await program.account.userState.fetch(accounts.userState);
    const poolKey = accounts.whirlpoolKey;
    const poolData = (await whirlpoolClient.getPool(poolKey)).getData();
    const vaultLcontractAtaBefore = await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.lcontractMint, accounts.userState, true);
    const whirlpool_oracle_pubkey = PDAUtil.getOracle(whirlpoolCtx.program.programId, poolKey).publicKey;

    // Arguments for swap
    const a_input = DecimalUtil.toU64(DecimalUtil.fromNumber(15), 6); // Long with 500 collateral
    const amount = new anchor.BN(a_input);
    const other_amount_threshold = new anchor.BN(0);
    const amount_specified_is_input = true;

    // Conditional Swap Direction, Super Important
    const a_to_b = poolData.tokenMintA.equals(accounts.collateralMint);
    const sqrt_price_limit = SwapUtils.getDefaultSqrtPriceLimit(a_to_b);
    const tickArrays = TickArrayUtil.getTickArrayPDAs(poolData.tickCurrentIndex, poolData.tickSpacing, 3, whirlpoolCtx.program.programId, poolKey, a_to_b);

    await program.methods
      .longUser(
        amount,
        other_amount_threshold,
        sqrt_price_limit,
        amount_specified_is_input,
        a_to_b,
      )
      .accounts({
        ...accounts,
        whirlpoolProgram: whirlpoolCtx.program.programId,
        whirlpool: poolKey,
        tokenVaultA: poolData.tokenVaultA,
        tokenVaultB: poolData.tokenVaultB,
        tickArray0: tickArrays[0].publicKey,
        tickArray1: tickArrays[1].publicKey,
        tickArray2: tickArrays[2].publicKey,
        oracle: whirlpool_oracle_pubkey,
        vaultLcontractAta: vaultLcontractAtaBefore.address,
      })
      .rpc().catch((e) => { console.log(e) });
    const vaultLcontractAtaAfter = await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.lcontractMint, accounts.userState, true);
    const userStateAccountAfter = await program.account.userState.fetch(accounts.userState);
    if (DEBUG_MODE) {
      console.log('Lcontract bought: ', userStateAccountAfter.lcontractBoughtAsUser.toNumber() / 1e6)
      console.log('No of lcontract Longed :', Number(vaultLcontractAtaAfter.amount - vaultLcontractAtaBefore.amount) / 1e6)
    }
    assert.ok(Number((vaultLcontractAtaAfter.amount - vaultLcontractAtaBefore.amount)) == userStateAccountAfter.lcontractBoughtAsUser.toNumber());
    assert.ok(userStateAccountAfter.contractPositionNet.toNumber() - userStateAccountBefore.contractPositionNet.toNumber() == userStateAccountAfter.lcontractBoughtAsUser.toNumber());
  });

  it("Trying to Close Long position more than what's opened - test User", async () => {
    let msg = '';

    // Getting all accounts for the swap
    const poolKey = accounts.whirlpoolKey;
    const poolData = (await whirlpoolClient.getPool(poolKey)).getData();
    const vaultLcontractAtaBefore = await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.lcontractMint, accounts.userState, true);
    const whirlpool_oracle_pubkey = PDAUtil.getOracle(whirlpoolCtx.program.programId, poolKey).publicKey;

    // Arguments for swap
    const userStateAccount = await program.account.userState.fetch(accounts.userState);
    const amountToClose = userStateAccount.lcontractBoughtAsUser.add(new BN(1)); // Amount greater than the position opened

    const a_input = DecimalUtil.toU64(DecimalUtil.fromNumber(amountToClose.toNumber())); // Close long position
    const amount = new anchor.BN(a_input);
    const other_amount_threshold = new anchor.BN(0);
    const amount_specified_is_input = true;

    // Conditional Swap Direction, Super Important
    const a_to_b = !poolData.tokenMintA.equals(accounts.collateralMint);
    const sqrt_price_limit = SwapUtils.getDefaultSqrtPriceLimit(a_to_b);
    const tickArrays = TickArrayUtil.getTickArrayPDAs(poolData.tickCurrentIndex, poolData.tickSpacing, 3, whirlpoolCtx.program.programId, poolKey, a_to_b);

    await program.methods
      .closeLongUser(
        amount,
        other_amount_threshold,
        sqrt_price_limit,
        amount_specified_is_input,
        a_to_b,
      )
      .accounts({
        ...accounts,
        whirlpoolProgram: whirlpoolCtx.program.programId,
        whirlpool: poolKey,
        tokenVaultA: poolData.tokenVaultA,
        tokenVaultB: poolData.tokenVaultB,
        tickArray0: tickArrays[0].publicKey,
        tickArray1: tickArrays[1].publicKey,
        tickArray2: tickArrays[2].publicKey,
        oracle: whirlpool_oracle_pubkey,
        vaultLcontractAta: vaultLcontractAtaBefore.address,
      })
      .rpc().catch((e) => { msg = e.error.errorCode.code });

    assert.ok(msg == 'ClosePositionBiggerThanOpened')
  });

  it("Close Long Contract - test User", async () => {
    // Getting all accounts for the swap
    const poolKey = accounts.whirlpoolKey;
    const poolData = (await whirlpoolClient.getPool(poolKey)).getData();
    const vaultLcontractAtaBefore = await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.lcontractMint, accounts.userState, true);
    accounts.vaultLcontractAta = vaultLcontractAtaBefore.address;
    const whirlpool_oracle_pubkey = PDAUtil.getOracle(whirlpoolCtx.program.programId, poolKey).publicKey;

    // Arguments for swap
    const userStateAccountBefore = await program.account.userState.fetch(accounts.userState);
    const amountToClose = userStateAccountBefore.lcontractBoughtAsUser.div(new BN(2)); // Close half the position

    const a_input = DecimalUtil.toU64(DecimalUtil.fromNumber(amountToClose.toNumber())); // Close long position
    const amount = new anchor.BN(a_input);
    const other_amount_threshold = new anchor.BN(0);
    const amount_specified_is_input = true;

    // Conditional Swap Direction, Super Important
    const a_to_b = !poolData.tokenMintA.equals(accounts.collateralMint);
    const sqrt_price_limit = SwapUtils.getDefaultSqrtPriceLimit(a_to_b);
    const tickArrays = TickArrayUtil.getTickArrayPDAs(poolData.tickCurrentIndex, poolData.tickSpacing, 3, whirlpoolCtx.program.programId, poolKey, a_to_b);

    await program.methods
      .closeLongUser(
        amount,
        other_amount_threshold,
        sqrt_price_limit,
        amount_specified_is_input,
        a_to_b,
      )
      .accounts({
        ...accounts,
        whirlpoolProgram: whirlpoolCtx.program.programId,
        whirlpool: poolKey,
        tokenVaultA: poolData.tokenVaultA,
        tokenVaultB: poolData.tokenVaultB,
        tickArray0: tickArrays[0].publicKey,
        tickArray1: tickArrays[1].publicKey,
        tickArray2: tickArrays[2].publicKey,
        oracle: whirlpool_oracle_pubkey,
        vaultLcontractAta: vaultLcontractAtaBefore.address,
      }).rpc().catch((e) => { console.log(e) });

    const vaultLcontractAtaAfter = await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.lcontractMint, accounts.userState, true);
    const userStateAccountAfter = await program.account.userState.fetch(accounts.userState);
    if (DEBUG_MODE) {
      console.log('Lcontract long position: ', userStateAccountAfter.lcontractBoughtAsUser.toNumber() / 1e6)
      console.log('No of lcontract Closed :', Number(vaultLcontractAtaAfter.amount - vaultLcontractAtaBefore.amount) / 1e6)
    }
    assert.ok(Number((vaultLcontractAtaBefore.amount - vaultLcontractAtaAfter.amount)) == amountToClose.toNumber())
    assert.ok(Number(userStateAccountBefore.lcontractBoughtAsUser.sub(userStateAccountAfter.lcontractBoughtAsUser)) == amountToClose.toNumber());
    assert.ok(Number(userStateAccountBefore.contractPositionNet.sub(userStateAccountAfter.contractPositionNet)) == amountToClose.toNumber());
  });

  it("Trigger Settle Mode - Maturity Reached", async () => {
    await program.methods.triggerSettleMode().accounts({ ...accounts }).rpc().catch((e) => console.log(e));
    const contractStateAccount = await program.account.contractState.fetch(accounts.contractState);
    const timeNow = (Date.now() / 1000)
    const endTime = (contractStateAccount.endingTime.toNumber())
    if (DEBUG_MODE) {
      console.log("Time difference from end - start: ", endTime - timeNow)
      console.log("Starting Price: ", contractStateAccount.startingPrice.toString());
      console.log("Ending Price: ", contractStateAccount.endingPrice.toString());
    }
    assert.ok(contractStateAccount.isSettling);
  });

  it("Settle shorts and mm, by admin", async () => {
    await program.methods.adminSettle().accounts({
      ...accounts,
    }).signers([superUser]).rpc().catch((e) => console.log(e));
  });

  it("Settle longs, by user", async () => {
    const vaultFreeCollateralAtaBefore = await getAccount(connection, accounts.vaultFreeCollateralAta);
    const vaultLcontractAtaBefore = await getAccount(connection, accounts.vaultLcontractAta);

    await program.methods.userSettleLong().accounts({
      ...accounts,
    }).rpc().catch((e) => console.log(e));
    if (DEBUG_MODE) {
      const vaultLcontractAtaAfter = await getAccount(connection, accounts.vaultLcontractAta);
      console.log('No of lContracts settled :', Number(vaultLcontractAtaAfter.amount - vaultLcontractAtaBefore.amount) / 1e6);
      const vaultFreeCollateralAtaAfter = await getAccount(connection, accounts.vaultFreeCollateralAta);
      console.log('Change in free collateral vault: ', Number(vaultFreeCollateralAtaAfter.amount - vaultFreeCollateralAtaBefore.amount) / 1e6);
    }
  });

  it("Settle longs, by mm", async () => {
    const vaultFreeCollateralAtaBefore = await getAccount(connection, accounts.vaultFreeCollateralAta);
    const mmLcontractAtaBefore = await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.lcontractMint, testUser.publicKey, true);
    const a_input = DecimalUtil.toU64(DecimalUtil.fromNumber(Number(mmLcontractAtaBefore.amount)), 0);
    await program.methods.mmSettleLong(a_input).accounts({
      ...accounts,
    }).rpc().catch((e) => console.log(e));

    if (DEBUG_MODE) {
      const mmLcontractAtaAfter = await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.lcontractMint, testUser.publicKey, true);
      console.log('No of lContracts settled :', Number(mmLcontractAtaAfter.amount - mmLcontractAtaBefore.amount) / 1e6);
      const vaultFreeCollateralAtaAfter = await getAccount(connection, accounts.vaultFreeCollateralAta);
      console.log('Change in free collateral vault: ', Number(vaultFreeCollateralAtaAfter.amount - vaultFreeCollateralAtaBefore.amount) / 1e6);
    }
  });


  xit("Checking collateraliation", async () => {
    //get supply of lcontract
    //get price of redemption of lcontract
    //check that it matches te amount of usd in the escrow
  })

});
