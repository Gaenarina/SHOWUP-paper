import {
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers.js";

import chai from "chai";

const { expect } = chai;

describe("Deposit Policy Comparison", function () {
  const BASE_DEPOSIT = 0.01;
  const OLD_EXTRA_DEPOSIT = 0.005;
  const BETA = 1;

  async function deployFixture() {
    const [admin, user] =
      await ethers.getSigners();

    const UserReputation =
      await ethers.getContractFactory(
        "UserReputation"
      );

    const reputation =
      await UserReputation.deploy();

    await reputation.waitForDeployment();

    await reputation
      .connect(user)
      .register("test-user");

    return {
      reputation,
      admin,
      user,
    };
  }

  function calculateOldDeposit(
    noShowCount
  ) {
    return (
      BASE_DEPOSIT +
      noShowCount *
        OLD_EXTRA_DEPOSIT
    );
  }

  function calculateNewDeposit(
    reputation
  ) {
    return (
      BASE_DEPOSIT *
      (
        1 +
        BETA *
          (
            1 -
            reputation / 100
          )
      )
    );
  }

  async function getState(
    reputationContract,
    user
  ) {
    const [
      ,
      reputation,
      noShowCount,
    ] =
      await reputationContract.getUser(
        user.address
      );

    return {
      reputation:
        Number(reputation),

      noShowCount:
        Number(noShowCount),
    };
  }

  function printRow(
    step,
    behavior,
    reputation,
    noShowCount
  ) {
    const oldDeposit =
      calculateOldDeposit(
        noShowCount
      );

    const newDeposit =
      calculateNewDeposit(
        reputation
      );

    console.log(
      `${step}\t${behavior}\t${reputation}\t${noShowCount}\t${oldDeposit.toFixed(
        4
      )}\t${newDeposit.toFixed(
        4
      )}`
    );

    return {
      oldDeposit,
      newDeposit,
    };
  }

  it("반복 노쇼 후 정상 이행에 따른 보증금 변화를 비교한다", async function () {
    const {
      reputation,
      user,
    } =
      await loadFixture(
        deployFixture
      );

    console.log("");
    console.log(
      "단계\t행동\t평판\t노쇼횟수\t기존보증금\t제안보증금"
    );

    /*
     * 초기 상태
     */
    let state =
      await getState(
        reputation,
        user
      );

    printRow(
      0,
      "초기",
      state.reputation,
      state.noShowCount
    );

    /*
     * 1. 노쇼
     * 100 -> 80
     */
    await reputation.recordNoShow(
      user.address
    );

    state =
      await getState(
        reputation,
        user
      );

    let result =
      printRow(
        1,
        "노쇼",
        state.reputation,
        state.noShowCount
      );

    expect(
      state.reputation
    ).to.equal(80);

    /*
     * 2. 노쇼
     * 80 -> 64
     */
    await reputation.recordNoShow(
      user.address
    );

    state =
      await getState(
        reputation,
        user
      );

    result =
      printRow(
        2,
        "노쇼",
        state.reputation,
        state.noShowCount
      );

    expect(
      state.reputation
    ).to.equal(64);

    /*
     * 3. 정상 이행
     * 64 -> 71
     */
    await reputation.rewardUser(
      user.address
    );

    state =
      await getState(
        reputation,
        user
      );

    result =
      printRow(
        3,
        "정상",
        state.reputation,
        state.noShowCount
      );

    expect(
      state.reputation
    ).to.equal(71);

    /*
     * 4. 정상 이행
     * 71 -> 76
     */
    await reputation.rewardUser(
      user.address
    );

    state =
      await getState(
        reputation,
        user
      );

    result =
      printRow(
        4,
        "정상",
        state.reputation,
        state.noShowCount
      );

    expect(
      state.reputation
    ).to.equal(76);

    /*
     * 5. 정상 이행
     * 76 -> 80
     */
    await reputation.rewardUser(
      user.address
    );

    state =
      await getState(
        reputation,
        user
      );

    result =
      printRow(
        5,
        "정상",
        state.reputation,
        state.noShowCount
      );

    expect(
      state.reputation
    ).to.equal(80);

    /*
     * 기존 방식은 누적 노쇼 횟수가
     * 줄어들지 않기 때문에 0.020 ETH 유지
     *
     * 제안 방식은 평판 회복에 따라
     * 보증금이 다시 감소
     */
    expect(
      calculateOldDeposit(
        state.noShowCount
      )
    ).to.equal(0.02);

    expect(
      calculateNewDeposit(
        state.reputation
      )
    ).to.be.closeTo(
      0.012,
      0.000001
    );
  });
});