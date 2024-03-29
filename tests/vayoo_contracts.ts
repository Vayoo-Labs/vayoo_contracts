import { DecimalUtil, Percentage } from "@orca-so/common-sdk";
import {
  AccountFetcher,
  buildWhirlpoolClient,
  PDAUtil,
  PriceMath,
  swapQuoteByOutputToken,
  SwapUtils,
  TickArrayUtil,
  WhirlpoolContext,
} from "@orca-so/whirlpools-sdk";
import * as anchor from "@project-serum/anchor";
import { Program, BN, web3 } from "@project-serum/anchor";
import {
  getAccount,
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
  getMint,
} from "@solana/spl-token-v2";
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import { SwitchboardProgram } from "@switchboard-xyz/solana.js";
import { assert } from "chai";
import { VayooContracts } from "../target/types/vayoo_contracts";
import { superUserKey, testUserKey } from "./testKeys";
import { sleep, toNativeAmount } from "./utils";
import {
  GLOBAL_STATE_SEED,
  PYTH_FEED,
  SWITCHBOARD_FEED,
  USDC_DECIMALS,
} from "./utils/constants";
import { FeedType } from "./utils/types";
import { addLiquidity, createWhirlpool } from "./whirlpoolUtils";
import { ORCA_WHIRLPOOL_PROGRAM_ID } from "./whirlpoolUtils/utils/constants";
import {
  createAndMintToAssociatedTokenAccount,
  createMint,
} from "./whirlpoolUtils/utils/token";

const DEBUG_MODE = true; // If true, log useful info accross the tests on the console

describe("vayoo_contracts", () => {
  const provider = anchor.AnchorProvider.env();
  // anchor.setProvider(provider);
  const program = anchor.workspace.VayooContracts as Program<VayooContracts>;
  const connection = program.provider.connection;
  const whirlpoolCtx = WhirlpoolContext.withProvider(
    provider,
    ORCA_WHIRLPOOL_PROGRAM_ID
  );
  const orcaFetcher = new AccountFetcher(connection);
  const whirlpoolClient = buildWhirlpoolClient(whirlpoolCtx);
  const superUser = superUserKey.keypair;
  const testUser = testUserKey.keypair;
  const testUserWallet = new anchor.Wallet(testUser);
  const pythFeed = new PublicKey(PYTH_FEED);
  const switchboardFeed = new PublicKey(SWITCHBOARD_FEED);
  let usdcMint: PublicKey;

  let starting_price_global=0

  let accounts: any = {
    pythFeed,
    switchboardFeed,
    systemProgram: SystemProgram.programId,
    rent: SYSVAR_RENT_PUBKEY,
    tokenProgram: TOKEN_PROGRAM_ID,
  };

  if (DEBUG_MODE) {
    console.log("Super User Key: ", superUser.publicKey.toString());
    console.log("Test User Key: ", testUser.publicKey.toString());
  }

  let mode_to_test=0;//0 => endprice==startprice | 1=> endprice>upperbound | 2=> endprice< lowerbound

  before("Setting up environment", async () => {
    const txHash = await connection.requestAirdrop(
      superUser.publicKey,
      LAMPORTS_PER_SOL * 10000
    );
    const txHash1 = await connection.requestAirdrop(
      testUser.publicKey,
      LAMPORTS_PER_SOL * 10000
    );
    await connection.confirmTransaction(txHash);
    await connection.confirmTransaction(txHash1);

    usdcMint = await createMint(provider);
    accounts.collateralMint = usdcMint;

    if (DEBUG_MODE) console.log("Collateral Mint: ", usdcMint.toString());

    // mint usdc tokens to superUser and testUser
    await createAndMintToAssociatedTokenAccount(
      provider,
      accounts.collateralMint,
      toNativeAmount(1000000, USDC_DECIMALS),
      testUser.publicKey
    );
    await createAndMintToAssociatedTokenAccount(
      provider,
      accounts.collateralMint,
      toNativeAmount(1000000, USDC_DECIMALS),
      superUser.publicKey
    );
  });

  it("Create Global State", async () => {
    const [globalStateKey, globalStateKeyBump] =
      web3.PublicKey.findProgramAddressSync(
        [Buffer.from(GLOBAL_STATE_SEED)],
        program.programId
      );
    accounts.globalState = globalStateKey;

    await program.methods
      .createGlobalState(globalStateKeyBump)
      .accounts({
        ...accounts,
        authority: superUser.publicKey,
      })
      .signers([superUser])
      .rpc()
      .catch((e) => {
        console.log(e);
      });

    const globalStateAccount = await program.account.globalState.fetch(
      globalStateKey
    );
    DEBUG_MODE
      ? console.log("Global State Key: ", globalStateKey.toString())
      : null;
    assert.ok(globalStateAccount.totalTvlUsdc.toNumber() == 0);
  });

  it("Initialize Contract Account/State - Switchboard", async () => {
    const amplitude = new BN(100_000);
    
    let need_to_find_relevant_mint = true;
    let contractName = "sb-xv1";
    let [scontractMint, scontractMintBump] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from(contractName), Buffer.from("scontract")],
        program.programId
      );
    let [lcontractMint, lcontractMintBump] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from(contractName), Buffer.from("lcontract")],
        program.programId
      );
    let [contractStateKey, contractStateKeyBump] =
      web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(contractName),
          lcontractMint.toBuffer(),
          superUser.publicKey.toBuffer(),
        ],
        program.programId
      );
    let timeNow = Math.floor(Date.now() / 1000);
    // const contractEndTime = new BN(timeNow + ONE_WEEK_IN_SECONDS);
    let contractEndTime = new BN(timeNow + 20);
    let name_seed_counter = 1;
    while (need_to_find_relevant_mint) {
      name_seed_counter = name_seed_counter + 1;
      contractName = "xv1" + name_seed_counter;
      timeNow = Math.floor(Date.now() / 1000);
      // const contractEndTime = new BN(timeNow + ONE_WEEK_IN_SECONDS);
      contractEndTime = new BN(timeNow + 20);

      [scontractMint, scontractMintBump] =
        anchor.web3.PublicKey.findProgramAddressSync(
          [Buffer.from(contractName), Buffer.from("scontract")],
          program.programId
        );
      [lcontractMint, lcontractMintBump] =
        anchor.web3.PublicKey.findProgramAddressSync(
          [Buffer.from(contractName), Buffer.from("lcontract")],
          program.programId
        );
      [contractStateKey, contractStateKeyBump] =
        web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from(contractName),
            lcontractMint.toBuffer(),
            superUser.publicKey.toBuffer(),
          ],
          program.programId
        );
      let [escrowVaultCollateral, escrowVaultCollateralBump] =
        anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from("escrow"),
            accounts.collateralMint.toBuffer(),
            contractStateKey.toBuffer(),
          ],
          program.programId
        );
      accounts.escrowVaultCollateral = escrowVaultCollateral;
      accounts.contractState = contractStateKey;
      accounts.contractAuthority = superUser.publicKey;
      accounts.lcontractMint = lcontractMint;
      accounts.scontractMint = scontractMint;

      if (lcontractMint.toString() < accounts.collateralMint.toString()) {
        DEBUG_MODE ?? console.log("Found relevant mint !!");
        need_to_find_relevant_mint = false;
        break;
      }
      if (DEBUG_MODE) {
        console.log("Token mint doesnt work");
        console.log(lcontractMint.toString());
        console.log(accounts.collateralMint.toString());
      }
    }
    await program.methods
      .initializeContract(
        contractName,
        contractStateKeyBump,
        contractEndTime,
        amplitude,
        FeedType.Switchboard
      )
      .accounts({
        ...accounts,
      })
      .signers([superUser])
      .rpc()
      .catch((e) => {
        console.log(e);
      });

    const contractStateAccount = await program.account.contractState.fetch(
      contractStateKey
    );
    if (DEBUG_MODE) {
      console.log("L Contract Mint Key: ", lcontractMint.toString());
      console.log("S Contract Mint Key: ", scontractMint.toString());
      console.log(
        "Contract Starting Price: ",
        contractStateAccount.startingPrice.toString()
      );
      console.log(
        "Contract Expo: ",
        contractStateAccount.oraclePriceMultiplier.toString()
      );
    }
    assert.ok(contractStateAccount.isHalted == false);
    assert.ok(contractStateAccount.oracleFeedKey.equals(switchboardFeed));
  });

  it("Cannot Trigger Settle Mode - Maturity Not Reached", async () => {
    let msg = "";
    const contractStateAccount = await program.account.contractState.fetch(
      accounts.contractState
    );
    
    if (true){
      await program.methods
        .triggerSettleMode()
        .accounts({ ...accounts })
        .signers([superUser])
        .rpc()
        .catch((e) => (msg = e.error.errorCode.code));}


    assert.ok(msg == "MaturityNotReached");
  });

  it("Initialize User State for test user", async () => {
    const [userStateKey, userStateKeyBump] =
      web3.PublicKey.findProgramAddressSync(
        [accounts.contractState.toBuffer(), testUser.publicKey.toBuffer()],
        program.programId
      );
    const [vaultFreeCollateralAta, vaultFreeCollateralAtaBump] =
      web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("free"),
          userStateKey.toBuffer(),
          accounts.collateralMint.toBuffer(),
        ],
        program.programId
      );
    const [vaultLockedCollateralAta, vaultLockedCollateralAtaBump] =
      web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("locked"),
          userStateKey.toBuffer(),
          accounts.collateralMint.toBuffer(),
        ],
        program.programId
      );
    const [vaultFreeScontractAta, vaultFreeScontractAtaBump] =
      web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("free"),
          userStateKey.toBuffer(),
          accounts.scontractMint.toBuffer(),
        ],
        program.programId
      );
    const [vaultLockedScontractAta, vaultLockedScontractAtaBump] =
      web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("locked"),
          userStateKey.toBuffer(),
          accounts.scontractMint.toBuffer(),
        ],
        program.programId
      );

    accounts.userState = userStateKey;
    accounts.userAuthority = testUser.publicKey;
    accounts.vaultFreeCollateralAta = vaultFreeCollateralAta;
    accounts.vaultLockedCollateralAta = vaultLockedCollateralAta;
    accounts.vaultFreeScontractAta = vaultFreeScontractAta;
    accounts.vaultLockedScontractAta = vaultLockedScontractAta;

    await program.methods
      .initializeUser(userStateKeyBump)
      .accounts({
        ...accounts,
      })
      .signers([testUser])
      .rpc()
      .catch((e) => {
        console.log(e);
      });

    const userStateAccount = await program.account.userState.fetch(
      userStateKey
    );
    DEBUG_MODE
      ? console.log("User State Key: ", userStateKey.toString())
      : null;
    assert.ok(userStateAccount.usdcDeposited.toNumber() == 0);
  });

  it("Create ATAs for test user", async () => {
    // Test PDAs
    await getOrCreateAssociatedTokenAccount(
      connection,
      testUser,
      accounts.lcontractMint,
      testUser.publicKey,
      true
    );
    await getOrCreateAssociatedTokenAccount(
      connection,
      testUser,
      accounts.collateralMint,
      testUser.publicKey,
      true
    );
  });

  it("Deposit Collateral for test User", async () => {
    const userCollateralAtaBefore = await getOrCreateAssociatedTokenAccount(
      connection,
      testUser,
      accounts.collateralMint,
      testUser.publicKey,
      true
    );
    const amountToDeposit = new BN(toNativeAmount(10000, USDC_DECIMALS));
    accounts.userCollateralAta = userCollateralAtaBefore.address;

    await program.methods
      .depositCollateral(amountToDeposit)
      .accounts({
        ...accounts,
      })
      .signers([testUser])
      .rpc()
      .catch((e) => {
        console.log(e);
      });
    const userUsdcAtaAfter = await getOrCreateAssociatedTokenAccount(
      connection,
      testUser,
      accounts.collateralMint,
      testUser.publicKey,
      true
    );

    const userStateAccount = await program.account.userState.fetch(
      accounts.userState
    );
    assert.ok(userStateAccount.usdcDeposited.eq(amountToDeposit));
    assert.ok(
      Number(userCollateralAtaBefore.amount - userUsdcAtaAfter.amount) ==
        amountToDeposit.toNumber()
    );
  });

  it("Mint lcontract as mm", async () => {
    const mmLcontractAta = await getOrCreateAssociatedTokenAccount(
      connection,
      testUser,
      accounts.lcontractMint,
      testUser.publicKey,
      true
    );

    const amountToMint = new BN(toNativeAmount(100, USDC_DECIMALS));
    accounts.mmLcontractAta = mmLcontractAta.address;
    accounts.mmLockedScontractAta = accounts.vaultLockedScontractAta;

    await program.methods
      .mintLContractMm(amountToMint)
      .accounts({
        ...accounts,
      })
      .signers([testUser])
      .rpc()
      .catch((e) => {
        console.log(e);
      });

    const userStateAccount = await program.account.userState.fetch(
      accounts.userState
    );
    assert.ok(userStateAccount.lcontractMintedAsMm.eq(amountToMint));
    if (DEBUG_MODE) {
      const mmLcontractAta = await getOrCreateAssociatedTokenAccount(
        connection,
        testUser,
        accounts.lcontractMint,
        testUser.publicKey,
        true
      );
      console.log("MM LContract Balance :", mmLcontractAta.amount.toString());
      const contractStateAccount = await program.account.contractState.fetch(
        accounts.contractState
      );
      console.log("LContract issued");
      let ratio =
        Number(contractStateAccount.globalCurrentLockedUsdc) /
        Number(contractStateAccount.globalCurrentIssuedLcontract);
      console.log("LContract issued : ",contractStateAccount.globalCurrentIssuedLcontract.toString());
      console.log("Locked USDC : ",contractStateAccount.globalCurrentLockedUsdc.toString());
      console.log("Ratio : ",ratio);

    }
  });

  it("Burn lcontract as mm", async () => {
    const userStateAccountBefore = await program.account.userState.fetch(
      accounts.userState
    );
    const amountToBurn = new BN(toNativeAmount(50, USDC_DECIMALS));

    await program.methods
      .burnLContractMm(amountToBurn)
      .accounts({
        ...accounts,
      })
      .signers([testUser])
      .rpc()
      .catch((e) => {
        console.log(e);
      });

    const userStateAccountAfter = await program.account.userState.fetch(
      accounts.userState
    );
    assert.ok(
      userStateAccountBefore.lcontractMintedAsMm
        .sub(userStateAccountAfter.lcontractMintedAsMm)
        .eq(amountToBurn)
    );
    if (DEBUG_MODE) {
      const mmLcontractAta = await getOrCreateAssociatedTokenAccount(
        connection,
        testUser,
        accounts.lcontractMint,
        testUser.publicKey,
        true
      );
      console.log("MM LContract Balance :", mmLcontractAta.amount.toString());
      const contractStateAccount = await program.account.contractState.fetch(
        accounts.contractState
      );

      let ratio =
        Number(contractStateAccount.globalCurrentLockedUsdc) /
        Number(contractStateAccount.globalCurrentIssuedLcontract);
      console.log("LContract issued : ",contractStateAccount.globalCurrentIssuedLcontract.toString());
      console.log("Locked USDC : ",contractStateAccount.globalCurrentLockedUsdc.toString());
      console.log("Ratio : ",ratio);
    }
  });

  it("Deploy whirlpool (lcontract / collateral ) + Add liquidity", async () => {
    const userlxAtaBefore = await getOrCreateAssociatedTokenAccount(
      connection,
      testUser,
      accounts.lcontractMint,
      testUser.publicKey,
      true
    );
    const userColAtaBefore = await getOrCreateAssociatedTokenAccount(
      connection,
      testUser,
      accounts.collateralMint,
      testUser.publicKey,
      true
    );
    const contractStateAccount = await program.account.contractState.fetch(
      accounts.contractState
    );
    let ratio =
    Number(contractStateAccount.globalCurrentLockedUsdc) /
    Number(contractStateAccount.globalCurrentIssuedLcontract);


    let addLiquidityAmount = 10; // amount in lcontract nb
    const initial_price = ratio/2; // initial price of the pool
    const spread = 0.01; // liquidity spread
    console.log('Starting price pool',initial_price)

    const whirlpoolKey = await createWhirlpool(
      whirlpoolCtx,
      testUserWallet,
      accounts.lcontractMint,
      accounts.collateralMint,
      initial_price
    );
    accounts.whirlpoolKey = whirlpoolKey;

    const poolData = (await whirlpoolClient.getPool(whirlpoolKey)).getData();
    const poolPrice = PriceMath.sqrtPriceX64ToPrice(poolData.sqrtPrice, 6, 6);
    if (DEBUG_MODE) {
      console.log("Pool Key: ", whirlpoolKey.toString());
      console.log("Pool Price1 : ", poolPrice);
      console.log("Pool Price2 : ", 1 / poolPrice.toNumber());
      console.log(
        "Token A is LContract",
        poolData.tokenMintA.equals(accounts.lcontractMint)
      );
    }
    if (!poolData.tokenMintA.equals(accounts.lcontractMint)) {
      console.log("lcontract mint not mint A");
      return;
    }

    const positionData = (
      await addLiquidity(
        whirlpoolCtx,
        whirlpoolKey,
        addLiquidityAmount,
        accounts.lcontractMint,
        spread
      )
    ).getData();

    const userlxAtaAfter = await getOrCreateAssociatedTokenAccount(
      connection,
      testUser,
      accounts.lcontractMint,
      testUser.publicKey,
      true
    );
    const userColAtaAfter = await getOrCreateAssociatedTokenAccount(
      connection,
      testUser,
      accounts.collateralMint,
      testUser.publicKey,
      true
    );

    if (DEBUG_MODE) {
      console.log("Pool Mint A: ", poolData.tokenMintA.toString());
      console.log("Pool Mint B: ", poolData.tokenMintB.toString());
      console.log(
        "Diff lcontract:",
        Number(userlxAtaAfter.amount - userlxAtaBefore.amount) / 1e6
      );
      console.log(
        "Diff collateral:",
        Number(userColAtaAfter.amount - userColAtaBefore.amount) / 1e6
      );
    }
    assert.ok(positionData.liquidity.toNumber() > 0);
  });

  it("Withdraw Collateral for test User", async () => {
    const userCollateralAtaBefore = await getOrCreateAssociatedTokenAccount(
      connection,
      testUser,
      accounts.collateralMint,
      testUser.publicKey,
      true
    );
    const amountToWithdraw = new BN(toNativeAmount(100, USDC_DECIMALS));

    await program.methods
      .withdrawCollateral(amountToWithdraw)
      .accounts({
        ...accounts,
      })
      .signers([testUser])
      .rpc()
      .catch((e) => {
        console.log(e);
      });

    const userUsdcAtaAfter = await getOrCreateAssociatedTokenAccount(
      connection,
      testUser,
      accounts.collateralMint,
      testUser.publicKey,
      true
    );
    assert.ok(
      Number(userUsdcAtaAfter.amount - userCollateralAtaBefore.amount) ==
        amountToWithdraw.toNumber()
    );
  });

  it("Cannot create user state - Contract Ended", async () => {
    let msg = "";
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
    const [contractStateKey, contractStateKeyBump] =
      web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(contractName),
          lcontractMint.toBuffer(),
          superUser.publicKey.toBuffer(),
        ],
        program.programId
      );
    const [escrowVaultCollateral, escrowVaultCollateralBump] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow"),
          accounts.collateralMint.toBuffer(),
          contractStateKey.toBuffer(),
        ],
        program.programId
      );

    // init contract with 3 second to the expiry
    await program.methods
      .initializeContract(
        contractName,
        contractStateKeyBump,
        contractEndTime,
        amplitude,
        FeedType.Pyth
      )
      .accounts({
        ...accounts,
        contractState: contractStateKey,
        lcontractMint: lcontractMint,
        scontractMint: scontractMint,
        escrowVaultCollateral: escrowVaultCollateral,
      })
      .signers([superUser])
      .rpc();

    // delay by 4 seconds
    await sleep(4);

    // try to create user state
    const [userStateKey, userStateKeyBump] =
      web3.PublicKey.findProgramAddressSync(
        [contractStateKey.toBuffer(), testUser.publicKey.toBuffer()],
        program.programId
      );
    const [vaultFreeCollateralAta, vaultFreeCollateralAtaBump] =
      web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("free"),
          userStateKey.toBuffer(),
          accounts.collateralMint.toBuffer(),
        ],
        program.programId
      );
    const [vaultLockedCollateralAta, vaultLockedCollateralAtaBump] =
      web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("locked"),
          userStateKey.toBuffer(),
          accounts.collateralMint.toBuffer(),
        ],
        program.programId
      );
    const [vaultFreeScontractAta, vaultFreeScontractAtaBump] =
      web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("free"),
          userStateKey.toBuffer(),
          accounts.scontractMint.toBuffer(),
        ],
        program.programId
      );
    const [vaultLockedScontractAta, vaultLockedScontractAtaBump] =
      web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("locked"),
          userStateKey.toBuffer(),
          accounts.scontractMint.toBuffer(),
        ],
        program.programId
      );

    await program.methods
      .initializeUser(userStateKeyBump)
      .accounts({
        ...accounts,
        userState: userStateKey,
        contractState: contractStateKey,
        vaultFreeCollateralAta,
        vaultLockedCollateralAta,
        vaultFreeScontractAta,
        vaultLockedScontractAta,
      })
      .signers([testUser])
      .rpc()
      .catch((e) => (msg = e.error.errorCode.code));
    assert.ok(msg == "ContractEnded");
  });

  it("Cannot deposit - Contract Ended", async () => {
    let msg = "";
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
    const [contractStateKey, contractStateKeyBump] =
      web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(contractName),
          lcontractMint.toBuffer(),
          superUser.publicKey.toBuffer(),
        ],
        program.programId
      );
    const [escrowVaultCollateral, escrowVaultCollateralBump] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow"),
          accounts.collateralMint.toBuffer(),
          contractStateKey.toBuffer(),
        ],
        program.programId
      );

    // init contract with 4 second to the expiry
    await program.methods
      .initializeContract(
        contractName,
        contractStateKeyBump,
        contractEndTime,
        amplitude,
        FeedType.Pyth
      )
      .accounts({
        ...accounts,
        contractState: contractStateKey,
        lcontractMint,
        scontractMint,
        escrowVaultCollateral,
      })
      .signers([superUser])
      .rpc();

    // create user state
    const [userStateKey, userStateKeyBump] =
      web3.PublicKey.findProgramAddressSync(
        [contractStateKey.toBuffer(), testUser.publicKey.toBuffer()],
        program.programId
      );
    const [vaultFreeCollateralAta, vaultFreeCollateralAtaBump] =
      web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("free"),
          userStateKey.toBuffer(),
          accounts.collateralMint.toBuffer(),
        ],
        program.programId
      );
    const [vaultLockedCollateralAta, vaultLockedCollateralAtaBump] =
      web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("locked"),
          userStateKey.toBuffer(),
          accounts.collateralMint.toBuffer(),
        ],
        program.programId
      );

    const [vaultFreeScontractAta, vaultFreeScontractAtaBump] =
      web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("free"),
          userStateKey.toBuffer(),
          accounts.scontractMint.toBuffer(),
        ],
        program.programId
      );
    const [vaultLockedScontractAta, vaultLockedScontractAtaBump] =
      web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("locked"),
          userStateKey.toBuffer(),
          accounts.scontractMint.toBuffer(),
        ],
        program.programId
      );

    await program.methods
      .initializeUser(userStateKeyBump)
      .accounts({
        ...accounts,
        userState: userStateKey,
        contractState: contractStateKey,
        vaultFreeCollateralAta,
        vaultLockedCollateralAta,
        vaultFreeScontractAta,
        vaultLockedScontractAta,
      })
      .signers([testUser])
      .rpc();

    // delay by 5 seconds
    await sleep(5);

    const amountToDeposit = new BN(toNativeAmount(0.02, USDC_DECIMALS));

    await program.methods
      .depositCollateral(amountToDeposit)
      .accounts({
        ...accounts,
        userState: userStateKey,
        contractState: contractStateKey,
        vaultFreeCollateralAta,
      })
      .signers([testUser])
      .rpc()
      .catch((e) => (msg = e.error.errorCode.code));
    assert.ok(msg == "ContractEnded");
  });

  it("Short Contract ", async () => {
    // Getting all accounts for the swap
    const poolKey = accounts.whirlpoolKey;
    const poolData = (await whirlpoolClient.getPool(poolKey)).getData();
    const vaultLcontractAtaBefore = await getOrCreateAssociatedTokenAccount(
      connection,
      testUser,
      accounts.lcontractMint,
      accounts.userState,
      true
    );
    const vaultScontractAtaBefore = await getAccount(
      connection,
      accounts.vaultLockedScontractAta
    );
    const vaultFreeCollateralAtaBefore = await getAccount(
      connection,
      accounts.vaultFreeCollateralAta
    );
    const vaultLockedCollateralAtaBefore = await getAccount(
      connection,
      accounts.vaultLockedCollateralAta
    );
    const whirlpool_oracle_pubkey = PDAUtil.getOracle(
      whirlpoolCtx.program.programId,
      poolKey
    ).publicKey;

    // Arguments for swap
    const userStateAccount = await program.account.userState.fetch(
      accounts.userState
    );
    const amountToClose = userStateAccount.lcontractBoughtAsUser;

    const a_input = DecimalUtil.toU64(DecimalUtil.fromNumber(2), 6); // open short
    const amount = new anchor.BN(a_input);
    const other_amount_threshold = new anchor.BN(0);
    const amount_specified_is_input = true;

    // Conditional Swap Direction, Super Important
    const a_to_b = !poolData.tokenMintA.equals(accounts.collateralMint);
    const sqrt_price_limit = SwapUtils.getDefaultSqrtPriceLimit(a_to_b);
    const tickArrays = TickArrayUtil.getTickArrayPDAs(
      poolData.tickCurrentIndex,
      poolData.tickSpacing,
      3,
      whirlpoolCtx.program.programId,
      poolKey,
      a_to_b
    );
    await program.methods
      .shortUser(amount, other_amount_threshold, sqrt_price_limit)
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
      .rpc()
      .catch((e) => {
        console.log(e);
      });
    const vaultLcontractAtaAfter = await getOrCreateAssociatedTokenAccount(
      connection,
      testUser,
      accounts.lcontractMint,
      accounts.userState,
      true
    );
    const vaultScontractAtaAfter = await getAccount(
      connection,
      accounts.vaultLockedScontractAta
    );
    const collateral_after = await getOrCreateAssociatedTokenAccount(
      connection,
      testUser,
      accounts.collateralMint,
      testUser.publicKey,
      true
    );
    const vaultFreeCollateralAtaAfter = await getAccount(
      connection,
      accounts.vaultFreeCollateralAta
    );
    const vaultLockedCollateralAtaAfter = await getAccount(
      connection,
      accounts.vaultLockedCollateralAta
    );

    if (DEBUG_MODE) {
      console.log(
        "No of new scontract :",
        Number(vaultScontractAtaAfter.amount - vaultScontractAtaBefore.amount) /
          1e6
      );
      console.log(
        "Free acc change :",
        Number(
          vaultFreeCollateralAtaAfter.amount -
            vaultFreeCollateralAtaBefore.amount
        ) / 1e6
      );
      console.log(
        "Locked acc change :",
        Number(
          vaultLockedCollateralAtaAfter.amount -
            vaultLockedCollateralAtaBefore.amount
        ) / 1e6
      );
      let amount_sold_in_pool =
        Number(
          vaultLockedCollateralAtaAfter.amount -
            vaultLockedCollateralAtaBefore.amount
        ) /
          1e6 +
        Number(
          vaultFreeCollateralAtaAfter.amount -
            vaultFreeCollateralAtaBefore.amount
        ) /
          1e6;
      let price_deduction =
        amount_sold_in_pool /
        (Number(
          vaultScontractAtaAfter.amount - vaultScontractAtaBefore.amount
        ) /
          1e6);
      console.log("Price paid to short in pool", price_deduction);
      const contractStateAccount = await program.account.contractState.fetch(
        accounts.contractState
      );

      let ratio =
        Number(contractStateAccount.globalCurrentLockedUsdc) /
        Number(contractStateAccount.globalCurrentIssuedLcontract);
      console.log("LContract issued : ",contractStateAccount.globalCurrentIssuedLcontract.toString());
      console.log("Locked USDC : ",contractStateAccount.globalCurrentLockedUsdc.toString());
      console.log("Ratio : ",ratio);
    }
  });

  it("Close Short Contract ", async () => {
    // Getting all accounts for the swap
    const poolKey = accounts.whirlpoolKey;
    const whirlpool = await whirlpoolClient.getPool(poolKey, true);
    const whirlpoolData = whirlpool.getData();
    const vaultLcontractAtaBefore = await getOrCreateAssociatedTokenAccount(
      connection,
      testUser,
      accounts.lcontractMint,
      accounts.userState,
      true
    );
    const whirlpool_oracle_pubkey = PDAUtil.getOracle(
      whirlpoolCtx.program.programId,
      poolKey
    ).publicKey;
    const vaultScontractAtaBefore = await getAccount(
      connection,
      accounts.vaultLockedScontractAta
    );
    const vaultFreeCollateralAtaBefore = await getAccount(
      connection,
      accounts.vaultFreeCollateralAta
    );
    const vaultLockedCollateralAtaBefore = await getAccount(
      connection,
      accounts.vaultLockedCollateralAta
    );

    const outputTokenQuote = await swapQuoteByOutputToken(
      whirlpool,
      accounts.lcontractMint,
      DecimalUtil.toU64(DecimalUtil.fromNumber(2), 6),
      Percentage.fromFraction(1, 10), // 0.1%
      ORCA_WHIRLPOOL_PROGRAM_ID,
      orcaFetcher,
      true
    );
    await program.methods
      .closeShortUser(
        outputTokenQuote.amount,
        outputTokenQuote.otherAmountThreshold,
        outputTokenQuote.sqrtPriceLimit
      )
      .accounts({
        ...accounts,
        whirlpoolProgram: whirlpoolCtx.program.programId,
        whirlpool: poolKey,
        tokenVaultA: whirlpoolData.tokenVaultA,
        tokenVaultB: whirlpoolData.tokenVaultB,
        tickArray0: outputTokenQuote.tickArray0,
        tickArray1: outputTokenQuote.tickArray1,
        tickArray2: outputTokenQuote.tickArray2,
        oracle: whirlpool_oracle_pubkey,
        vaultLcontractAta: vaultLcontractAtaBefore.address,
        vaultScontractAta: vaultScontractAtaBefore.address,
      })
      .rpc()
      .catch((e) => {
        console.log(e);
      });
    const vaultScontractAtaAfter = await getAccount(
      connection,
      accounts.vaultLockedScontractAta
    );

    const vaultFreeCollateralAtaAfter = await getAccount(
      connection,
      accounts.vaultFreeCollateralAta
    );
    const vaultLockedCollateralAtaAfter = await getAccount(
      connection,
      accounts.vaultLockedCollateralAta
    );

    const vaultLcontractAtaAfter = await getOrCreateAssociatedTokenAccount(
      connection,
      testUser,
      accounts.lcontractMint,
      accounts.userState,
      true
    );
    if (DEBUG_MODE) {
      console.log(
        "No of scontract :",
        Number(vaultScontractAtaAfter.amount - vaultScontractAtaBefore.amount) /
          1e6
      );
      console.log(
        "Free acc change :",
        Number(
          vaultFreeCollateralAtaAfter.amount -
            vaultFreeCollateralAtaBefore.amount
        ) / 1e6
      );
      console.log(
        "Locked acc change :",
        Number(
          vaultLockedCollateralAtaAfter.amount -
            vaultLockedCollateralAtaBefore.amount
        ) / 1e6
      );
      let amount_sold_in_pool =
        Number(
          vaultLockedCollateralAtaAfter.amount -
            vaultLockedCollateralAtaBefore.amount
        ) /
          1e6 +
        Number(
          vaultFreeCollateralAtaAfter.amount -
            vaultFreeCollateralAtaBefore.amount
        ) /
          1e6;
      let price_deduction =
        amount_sold_in_pool /
        (Number(
          vaultScontractAtaAfter.amount - vaultScontractAtaBefore.amount
        ) /
          1e6);
      console.log("Price paid to close short in pool", price_deduction);
      const contractStateAccount = await program.account.contractState.fetch(
        accounts.contractState
      );
  
      let ratio =
        Number(contractStateAccount.globalCurrentLockedUsdc) /
        Number(contractStateAccount.globalCurrentIssuedLcontract);
      console.log(contractStateAccount.globalCurrentIssuedLcontract.toString());
      console.log(contractStateAccount.globalCurrentLockedUsdc.toString());
      console.log("LContract issued : ",contractStateAccount.globalCurrentIssuedLcontract.toString());
      console.log("Locked USDC : ",contractStateAccount.globalCurrentLockedUsdc.toString());
      console.log("Ratio : ",ratio);
    }
  });

  it("Long Contract - test User", async () => {
    // Getting all accounts for the swap
    const userStateAccountBefore = await program.account.userState.fetch(
      accounts.userState
    );
    const poolKey = accounts.whirlpoolKey;
    const poolData = (await whirlpoolClient.getPool(poolKey)).getData();
    const vaultLcontractAtaBefore = await getOrCreateAssociatedTokenAccount(
      connection,
      testUser,
      accounts.lcontractMint,
      accounts.userState,
      true
    );
    const whirlpool_oracle_pubkey = PDAUtil.getOracle(
      whirlpoolCtx.program.programId,
      poolKey
    ).publicKey;
    const whirlpool = await whirlpoolClient.getPool(poolKey, true);
    // Arguments for swap
    const outputTokenQuote = await swapQuoteByOutputToken(
      whirlpool,
      accounts.lcontractMint,
      DecimalUtil.toU64(DecimalUtil.fromNumber(1), 6),
      Percentage.fromFraction(1, 10), // 0.1%
      ORCA_WHIRLPOOL_PROGRAM_ID,
      orcaFetcher,
      true
    );

    await program.methods
      .longUser(
        outputTokenQuote.amount,
        outputTokenQuote.otherAmountThreshold,
        outputTokenQuote.sqrtPriceLimit
      )
      .accounts({
        ...accounts,
        whirlpoolProgram: whirlpoolCtx.program.programId,
        whirlpool: poolKey,
        tokenVaultA: poolData.tokenVaultA,
        tokenVaultB: poolData.tokenVaultB,
        tickArray0: outputTokenQuote.tickArray0,
        tickArray1: outputTokenQuote.tickArray1,
        tickArray2: outputTokenQuote.tickArray2,
        oracle: whirlpool_oracle_pubkey,
        vaultLcontractAta: vaultLcontractAtaBefore.address,
      })
      .rpc()
      .catch((e) => {
        console.log(e);
      });
    const vaultLcontractAtaAfter = await getOrCreateAssociatedTokenAccount(
      connection,
      testUser,
      accounts.lcontractMint,
      accounts.userState,
      true
    );
    const userStateAccountAfter = await program.account.userState.fetch(
      accounts.userState
    );
    if (DEBUG_MODE) {
      console.log(
        "Lcontract bought: ",
        userStateAccountAfter.lcontractBoughtAsUser.toNumber() / 1e6
      );
      console.log(
        "No of lcontract Longed :",
        Number(vaultLcontractAtaAfter.amount - vaultLcontractAtaBefore.amount) /
          1e6
      );
    }
    assert.ok(
      Number(vaultLcontractAtaAfter.amount - vaultLcontractAtaBefore.amount) ==
        userStateAccountAfter.lcontractBoughtAsUser.toNumber()
    );
    assert.ok(
      userStateAccountAfter.contractPositionNet.toNumber() -
        userStateAccountBefore.contractPositionNet.toNumber() ==
        userStateAccountAfter.lcontractBoughtAsUser.toNumber()
    );
  });

  it("Trying to Close Long position more than what's opened - test User", async () => {
    let msg = "";

    // Getting all accounts for the swap
    const poolKey = accounts.whirlpoolKey;
    const poolData = (await whirlpoolClient.getPool(poolKey)).getData();
    const vaultLcontractAtaBefore = await getOrCreateAssociatedTokenAccount(
      connection,
      testUser,
      accounts.lcontractMint,
      accounts.userState,
      true
    );
    const whirlpool_oracle_pubkey = PDAUtil.getOracle(
      whirlpoolCtx.program.programId,
      poolKey
    ).publicKey;

    // Arguments for swap
    const userStateAccount = await program.account.userState.fetch(
      accounts.userState
    );
    const amountToClose = userStateAccount.lcontractBoughtAsUser.add(new BN(1)); // Amount greater than the position opened

    const a_input = DecimalUtil.toU64(
      DecimalUtil.fromNumber(amountToClose.toNumber())
    ); // Close long position
    const amount = new anchor.BN(a_input);
    const other_amount_threshold = new anchor.BN(0);

    // Conditional Swap Direction, Super Important
    const a_to_b = !poolData.tokenMintA.equals(accounts.collateralMint);
    const sqrt_price_limit = SwapUtils.getDefaultSqrtPriceLimit(a_to_b);
    const tickArrays = TickArrayUtil.getTickArrayPDAs(
      poolData.tickCurrentIndex,
      poolData.tickSpacing,
      3,
      whirlpoolCtx.program.programId,
      poolKey,
      a_to_b
    );

    await program.methods
      .closeLongUser(amount, other_amount_threshold, sqrt_price_limit)
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
      .rpc()
      .catch((e) => {
        msg = e.error.errorCode.code;
      });

    assert.ok(msg == "ClosePositionBiggerThanOpened");
  });

  it("Close Long Contract - test User", async () => {
    // Getting all accounts for the swap
    const poolKey = accounts.whirlpoolKey;
    const poolData = (await whirlpoolClient.getPool(poolKey)).getData();
    const vaultLcontractAtaBefore = await getOrCreateAssociatedTokenAccount(
      connection,
      testUser,
      accounts.lcontractMint,
      accounts.userState,
      true
    );
    accounts.vaultLcontractAta = vaultLcontractAtaBefore.address;
    const whirlpool_oracle_pubkey = PDAUtil.getOracle(
      whirlpoolCtx.program.programId,
      poolKey
    ).publicKey;

    // Arguments for swap
    const userStateAccountBefore = await program.account.userState.fetch(
      accounts.userState
    );
    const amountToClose = userStateAccountBefore.lcontractBoughtAsUser.div(
      new BN(2)
    ); // Close half the position

    const a_input = DecimalUtil.toU64(
      DecimalUtil.fromNumber(amountToClose.toNumber())
    ); // Close long position
    const amount = new anchor.BN(a_input);
    const other_amount_threshold = new anchor.BN(0);

    // Conditional Swap Direction, Super Important
    const a_to_b = !poolData.tokenMintA.equals(accounts.collateralMint);
    const sqrt_price_limit = SwapUtils.getDefaultSqrtPriceLimit(a_to_b);
    const tickArrays = TickArrayUtil.getTickArrayPDAs(
      poolData.tickCurrentIndex,
      poolData.tickSpacing,
      3,
      whirlpoolCtx.program.programId,
      poolKey,
      a_to_b
    );
    await program.methods
      .closeLongUser(amount, other_amount_threshold, sqrt_price_limit)
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
      .rpc()
      .catch((e) => {
        console.log(e);
      });

    const vaultLcontractAtaAfter = await getOrCreateAssociatedTokenAccount(
      connection,
      testUser,
      accounts.lcontractMint,
      accounts.userState,
      true
    );
    const userStateAccountAfter = await program.account.userState.fetch(
      accounts.userState
    );
    if (DEBUG_MODE) {
      console.log(
        "Lcontract long position: ",
        userStateAccountAfter.lcontractBoughtAsUser.toNumber() / 1e6
      );
      console.log(
        "No of lcontract Closed :",
        Number(vaultLcontractAtaAfter.amount - vaultLcontractAtaBefore.amount) /
          1e6
      );
    }
    assert.ok(
      Number(vaultLcontractAtaBefore.amount - vaultLcontractAtaAfter.amount) ==
        amountToClose.toNumber()
    );
    assert.ok(
      Number(
        userStateAccountBefore.lcontractBoughtAsUser.sub(
          userStateAccountAfter.lcontractBoughtAsUser
        )
      ) == amountToClose.toNumber()
    );
    assert.ok(
      Number(
        userStateAccountBefore.contractPositionNet.sub(
          userStateAccountAfter.contractPositionNet
        )
      ) == amountToClose.toNumber()
    );
  });

  it("Trigger Settle Mode - Maturity Reached", async () => {
    await sleep(10);
    const contractStateAccountBefore = await program.account.contractState.fetch(
      accounts.contractState
    );
    if (mode_to_test==0){
    await program.methods
      .triggerSettleMode()
      .accounts({ ...accounts })
      .signers([superUser])
      .rpc()
      .catch((e) => console.log(e));}
    

    if (mode_to_test==1){
      const end_price = Number(contractStateAccountBefore.startingPrice)-10_000_000;
      console.log("Triggered with a price of ",end_price)
      await program.methods
        .adminTriggersSettleMode(new BN(end_price))
        .accounts({ ...accounts })
        .signers([superUser])
        .rpc()
        .catch((e) => console.log(e));}


    if (mode_to_test==2){
      
      const end_price = Number(contractStateAccountBefore.startingPrice)+35_000_000;
      console.log("Triggered with a price of ",end_price)
      await program.methods
        .adminTriggersSettleMode(new BN(end_price))
        .accounts({ ...accounts })
        .signers([superUser])
        .rpc()
        .catch((e) => console.log(e));}
    const contractStateAccount = await program.account.contractState.fetch(
      accounts.contractState
    );
    const timeNow = Date.now() / 1000;
    const endTime = contractStateAccount.endingTime.toNumber();
    if (DEBUG_MODE) {
      console.log("Time difference from end - start: ", endTime - timeNow);
      console.log(
        "Starting Price: ",
        contractStateAccount.startingPrice.toString()
      );
      console.log(
        "Ending Price: ",
        contractStateAccount.endingPrice.toString()
      );
    }
    assert.ok(contractStateAccount.isSettling);
  });

  it("Settle mm, by admin", async () => {
    const vaultFreeCollateralAtaBefore = await getAccount(
      connection,
      accounts.vaultFreeCollateralAta
    );

    const vaultLockedCollateralAtaBefore = await getAccount(
      connection,
      accounts.vaultLockedCollateralAta
    );

    const vaultScontractAtaBefore = await getAccount(
      connection,
      accounts.vaultLockedScontractAta
    );

    const vaultEscrowAtaBefore = await getAccount(
      connection,
      accounts.escrowVaultCollateral
    );

    await program.methods
      .adminSettle()
      .accounts({
        ...accounts,
      })
      .signers([superUser])
      .rpc()
      .catch((e) => console.log(e));

    const vaultFreeCollateralAtaAfter = await getAccount(
      connection,
      accounts.vaultFreeCollateralAta
    );
    const vaultLockedCollateralAtaAfter = await getAccount(
      connection,
      accounts.vaultLockedCollateralAta
    );
    const vaultScontractAtaAfter = await getAccount(
      connection,
      accounts.vaultLockedScontractAta
    );
    const vaultEscrowAtaAfter = await getAccount(
      connection,
      accounts.escrowVaultCollateral
    );

    if (DEBUG_MODE) {
      console.log(
        "No of SContracts settled :",
        Number(vaultScontractAtaAfter.amount - vaultScontractAtaBefore.amount) /
          1e6
      );
      console.log(
        "Change in free collateral vault: ",
        Number(
          vaultFreeCollateralAtaAfter.amount -
            vaultFreeCollateralAtaBefore.amount
        ) / 1e6
      );
      console.log(
        "Change in locked collateral vault: ",
        Number(
          vaultLockedCollateralAtaAfter.amount -
            vaultLockedCollateralAtaBefore.amount
        ) / 1e6
      );
      console.log(
        "Change in escrow collateral vault: ",
        Number(vaultEscrowAtaAfter.amount - vaultEscrowAtaBefore.amount) / 1e6
      );

      let implied_setteling_price =
        Number(
          vaultFreeCollateralAtaAfter.amount -
            vaultFreeCollateralAtaBefore.amount
        ) /
        1e6 /
        (Number(
          vaultScontractAtaAfter.amount - vaultScontractAtaBefore.amount
        ) /
          1e6);
      console.log(
        "implied_setteling_price settle long user: ",
        implied_setteling_price
      );

      const contractStateAccount = await program.account.contractState.fetch(
        accounts.contractState
      );
    
      let ratio =
        Number(contractStateAccount.globalCurrentLockedUsdc) /
        Number(contractStateAccount.globalCurrentIssuedLcontract);
      console.log("LContract issued : ",contractStateAccount.globalCurrentIssuedLcontract.toString());
      console.log("Locked USDC : ",contractStateAccount.globalCurrentLockedUsdc.toString());
      console.log("Ratio : ",ratio);
    }
  });




  it("Settle longs, by user", async () => {
    const vaultFreeCollateralAtaBefore = await getAccount(
      connection,
      accounts.vaultFreeCollateralAta
    );
    const vaultLcontractAtaBefore = await getAccount(
      connection,
      accounts.vaultLcontractAta
    );

    await program.methods
      .userSettleLong()
      .accounts({
        ...accounts,
      })
      .rpc()
      .catch((e) => console.log(e));
    if (DEBUG_MODE) {
      const vaultLcontractAtaAfter = await getAccount(
        connection,
        accounts.vaultLcontractAta
      );
      console.log(
        "No of lContracts settled :",
        Number(vaultLcontractAtaAfter.amount - vaultLcontractAtaBefore.amount) /
          1e6
      );
      const vaultFreeCollateralAtaAfter = await getAccount(
        connection,
        accounts.vaultFreeCollateralAta
      );
      console.log(
        "Change in free collateral vault: ",
        Number(
          vaultFreeCollateralAtaAfter.amount -
            vaultFreeCollateralAtaBefore.amount
        ) / 1e6
      );
      let implied_setteling_price =
        Number(
          vaultFreeCollateralAtaAfter.amount -
            vaultFreeCollateralAtaBefore.amount
        ) /
        1e6 /
        (Number(
          vaultLcontractAtaAfter.amount - vaultLcontractAtaBefore.amount
        ) /
          1e6);
      console.log(
        "implied_setteling_price settle long us: ",
        implied_setteling_price
      );

      const contractStateAccount = await program.account.contractState.fetch(
        accounts.contractState
      );
  
      let ratio =
        Number(contractStateAccount.globalCurrentLockedUsdc) /
        Number(contractStateAccount.globalCurrentIssuedLcontract);
      console.log("LContract issued : ",contractStateAccount.globalCurrentIssuedLcontract.toString());
      console.log("Locked USDC : ",contractStateAccount.globalCurrentLockedUsdc.toString());
      console.log("Ratio : ",ratio);
    }
  });

  it("Settle longs, by mm", async () => {
    const vaultFreeCollateralAtaBefore =
      await getOrCreateAssociatedTokenAccount(
        connection,
        testUser,
        accounts.collateralMint,
        testUser.publicKey,
        true
      );
    const mmLcontractAtaBefore = await getOrCreateAssociatedTokenAccount(
      connection,
      testUser,
      accounts.lcontractMint,
      testUser.publicKey,
      true
    );
    const a_input = DecimalUtil.toU64(
      DecimalUtil.fromNumber(Number(mmLcontractAtaBefore.amount)),
      0
    );
    accounts.mmCollateralWalletAta = vaultFreeCollateralAtaBefore.address;
    await program.methods
      .mmSettleLong(a_input)
      .accounts({
        ...accounts,
      })
      .rpc()
      .catch((e) => console.log(e));
    const vaultFreeCollateralAtaAfter = await getOrCreateAssociatedTokenAccount(
      connection,
      testUser,
      accounts.collateralMint,
      testUser.publicKey,
      true
    );
    const mmLcontractAtaAfter = await getOrCreateAssociatedTokenAccount(
      connection,
      testUser,
      accounts.lcontractMint,
      testUser.publicKey,
      true
    );

    if (DEBUG_MODE) {
      console.log(
        "No of lContracts settled :",
        Number(mmLcontractAtaAfter.amount - mmLcontractAtaBefore.amount) / 1e6
      );
      console.log(
        "Change in free collateral vault: ",
        Number(
          vaultFreeCollateralAtaAfter.amount -
            vaultFreeCollateralAtaBefore.amount
        ) / 1e6
      );
      let implied_setteling_price =
        Number(
          vaultFreeCollateralAtaAfter.amount -
            vaultFreeCollateralAtaBefore.amount
        ) /
        1e6 /
        (Number(mmLcontractAtaAfter.amount - mmLcontractAtaBefore.amount) /
          1e6);
      console.log("implied_setteling_price: ", implied_setteling_price);

      const contractStateAccount = await program.account.contractState.fetch(
        accounts.contractState
      );
      
      let ratio =
        Number(contractStateAccount.globalCurrentLockedUsdc) /
        Number(contractStateAccount.globalCurrentIssuedLcontract);
      console.log("LContract issued : ",contractStateAccount.globalCurrentIssuedLcontract.toString());
      console.log("Locked USDC : ",contractStateAccount.globalCurrentLockedUsdc.toString());
      console.log("Ratio : ",ratio);
    }
  });

  it("Checking collateraliation", async () => {
    if (DEBUG_MODE) {
      //get supply of lcontract
      //get price of redemption of lcontract
      //check that it matches te amount of usd in the escrow
      const mintInfo1 = await getMint(connection, accounts.lcontractMint);

      console.log(mintInfo1);
      console.log(mintInfo1.supply.toString());
      const vaultScontractAtaAfter = await getAccount(
        connection,
        accounts.escrowVaultCollateral
      );
      let amount_collateral = Number(vaultScontractAtaAfter.amount) / 1e6;
      let supply_glob = Number(mintInfo1.supply) / 1e6;
      console.log("amount_collateral");
      console.log(amount_collateral);
      console.log("supply_glob");
      console.log(supply_glob);
      let implied_price_structure = amount_collateral / supply_glob;
      console.log("Implied price");
      console.log(implied_price_structure);
    }
  });
});
