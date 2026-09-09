import {
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers.js";
import chai from "chai";

const { expect } = chai;

describe("UserReputation", function () {
  async function deployUserReputationFixture() {
    const [admin, user] = await ethers.getSigners();

    const UserReputation =
      await ethers.getContractFactory("UserReputation");

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

  describe("초기 평판", function () {
    it("신규 사용자의 평판은 100이고 노쇼 횟수는 0이다", async function () {
      const { reputation, user } =
        await loadFixture(
          deployUserReputationFixture
        );

      const [, score, noShowCount, isRegistered] =
        await reputation.getUser(user.address);

      expect(score).to.equal(100);
      expect(noShowCount).to.equal(0);
      expect(isRegistered).to.equal(true);
    });
  });

  describe("반복 노쇼", function () {
    it("평판이 100 → 80 → 64로 감소한다", async function () {
      const { reputation, user } =
        await loadFixture(
          deployUserReputationFixture
        );

      await reputation.recordNoShow(
        user.address
      );

      let [, score, noShowCount] =
        await reputation.getUser(
          user.address
        );

      expect(score).to.equal(80);
      expect(noShowCount).to.equal(1);

      await reputation.recordNoShow(
        user.address
      );

      [, score, noShowCount] =
        await reputation.getUser(
          user.address
        );

      expect(score).to.equal(64);
      expect(noShowCount).to.equal(2);
    });
  });

  describe("평판 회복", function () {
    it("노쇼 후 정상 이행이 반복되면 평판이 점진적으로 회복된다", async function () {
      const { reputation, user } =
        await loadFixture(
          deployUserReputationFixture
        );

      // 100 → 80
      await reputation.recordNoShow(
        user.address
      );

      let [, score] =
        await reputation.getUser(
          user.address
        );

      expect(score).to.equal(80);

      // 80 → 84
      await reputation.rewardUser(
        user.address
      );

      [, score] =
        await reputation.getUser(
          user.address
        );

      expect(score).to.equal(84);

      // 84 → 87
      await reputation.rewardUser(
        user.address
      );

      [, score] =
        await reputation.getUser(
          user.address
        );

      expect(score).to.equal(87);

      // 87 → 89
      await reputation.rewardUser(
        user.address
      );

      [, score] =
        await reputation.getUser(
          user.address
        );

      expect(score).to.equal(89);
    });
  });

  describe("정상 이행 유지", function () {
    it("평판 100인 사용자가 정상 이행을 반복하면 100을 유지한다", async function () {
      const { reputation, user } =
        await loadFixture(
          deployUserReputationFixture
        );

      await reputation.rewardUser(
        user.address
      );

      await reputation.rewardUser(
        user.address
      );

      await reputation.rewardUser(
        user.address
      );

      const [, score, noShowCount] =
        await reputation.getUser(
          user.address
        );

      expect(score).to.equal(100);
      expect(noShowCount).to.equal(0);
    });
  });

  describe("노쇼 이력 유지", function () {
    it("정상 이행으로 평판이 회복되어도 누적 노쇼 횟수는 유지된다", async function () {
      const { reputation, user } =
        await loadFixture(
          deployUserReputationFixture
        );

      await reputation.recordNoShow(
        user.address
      );

      await reputation.rewardUser(
        user.address
      );

      await reputation.rewardUser(
        user.address
      );

      const [, score, noShowCount] =
        await reputation.getUser(
          user.address
        );

      expect(score).to.equal(87);
      expect(noShowCount).to.equal(1);
    });
  });
});