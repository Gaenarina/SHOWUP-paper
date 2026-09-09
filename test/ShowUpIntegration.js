import {
  loadFixture,
  time,
} from "@nomicfoundation/hardhat-toolbox/network-helpers.js";
import chai from "chai";

const { expect } = chai;

describe("SHOWUP Integration", function () {
  async function deployShowUpFixture() {
    const [admin, consumer, seller] =
      await ethers.getSigners();

    // 1. UserReputation 배포
    const UserReputation =
      await ethers.getContractFactory(
        "UserReputation"
      );

    const reputation =
      await UserReputation.deploy();

    await reputation.waitForDeployment();

    // 소비자 등록
    await reputation
      .connect(consumer)
      .register("consumer");

    // 판매자 등록
    await reputation
      .connect(seller)
      .register("seller");

    // 2. NoShowDeposit 배포
    const NoShowDeposit =
      await ethers.getContractFactory(
        "NoShowDeposit"
      );

    const deposit =
      await NoShowDeposit.deploy(
        await reputation.getAddress()
      );

    await deposit.waitForDeployment();

    // 3. NoShowDeposit이 평판을 변경할 수 있도록 권한 부여
    await reputation.setAuthorizedUpdater(
      await deposit.getAddress(),
      true
    );

    return {
      reputation,
      deposit,
      admin,
      consumer,
      seller,
    };
  }

  async function createReservation({
    deposit,
    consumer,
    seller,
    appointmentId,
    amount,
  }) {
    const latest =
      await time.latest();

    const reservationTime =
      latest + 60;

    const reservationDateStart =
      latest;

    await deposit
      .connect(consumer)
      .createAndPayDeposit(
        appointmentId,
        seller.address,
        reservationTime,
        reservationDateStart,
        {
          value: amount,
        }
      );

    return {
      reservationTime,
    };
  }

  describe("컨트랙트 연동 설정", function () {
    it("NoShowDeposit이 평판 갱신 권한을 가진다", async function () {
      const {
        reputation,
        deposit,
      } = await loadFixture(
        deployShowUpFixture
      );

      const allowed =
        await reputation.authorizedUpdaters(
          await deposit.getAddress()
        );

      expect(allowed).to.equal(true);
    });
  });

  describe("정상 예약 이행", function () {
    it("정상 이행 시 보증금이 반환되고 평판이 회복된다", async function () {
      const {
        reputation,
        deposit,
        consumer,
        seller,
      } = await loadFixture(
        deployShowUpFixture
      );

      const appointmentId = 1;
      const amount =
        ethers.parseEther("0.01");

      /*
       * 정상 이행에 따른 평판 회복을
       * 확인하기 위해 초기 평판을 80으로 만든다.
       *
       * 100 → 노쇼 기록 → 80
       */
      await reputation.recordNoShow(
        consumer.address
      );

      let [, score] =
        await reputation.getUser(
          consumer.address
        );

      expect(score).to.equal(80);

      const {
        reservationTime,
      } = await createReservation({
        deposit,
        consumer,
        seller,
        appointmentId,
        amount,
      });

      // 예약 시간으로 이동
      await time.increaseTo(
        reservationTime
      );

      // 판매자 확인
      await deposit
        .connect(seller)
        .confirmBySeller(
          appointmentId
        );

      // 소비자 확인
      await deposit
        .connect(consumer)
        .confirmByConsumer(
          appointmentId
        );

      /*
       * 정상 이행 정산
       * → 소비자 보증금 반환
       * → rewardUser 호출
       */
      await deposit
        .connect(consumer)
        .settleVisited(
          appointmentId
        );

      const depositInfo =
        await deposit.deposits(
          appointmentId
        );

      // settled
      expect(
        depositInfo[9]
      ).to.equal(true);

      // result = 1 (정상 이행)
      expect(
        depositInfo[10]
      ).to.equal(1);

      /*
       * 평판:
       * 80 → 84
       */
      [, score] =
        await reputation.getUser(
          consumer.address
        );

      expect(score).to.equal(84);

      // 정산 후 컨트랙트 보증금 잔액 0
      expect(
        await deposit.getContractBalance()
      ).to.equal(0);
    });
  });

  describe("노쇼 처리", function () {
    it("노쇼 발생 시 보증금이 판매자에게 정산되고 소비자 평판이 감소한다", async function () {
      const {
        reputation,
        deposit,
        consumer,
        seller,
      } = await loadFixture(
        deployShowUpFixture
      );

      const appointmentId = 2;
      const amount =
        ethers.parseEther("0.01");

      const {
        reservationTime,
      } = await createReservation({
        deposit,
        consumer,
        seller,
        appointmentId,
        amount,
      });

      // 예약 시간으로 이동
      await time.increaseTo(
        reservationTime
      );

      // 판매자 확인
      await deposit
        .connect(seller)
        .confirmBySeller(
          appointmentId
        );

      /*
       * 소비자는 인증하지 않음
       *
       * 판매자 인증 후
       * 20분 + 1초 경과
       */
      await time.increase(
        20 * 60 + 1
      );

      // 노쇼 정산
      await deposit
        .connect(seller)
        .settleNoShow(
          appointmentId
        );

      const depositInfo =
        await deposit.deposits(
          appointmentId
        );

      // consumerConfirmed = false
      expect(
        depositInfo[8]
      ).to.equal(false);

      // settled = true
      expect(
        depositInfo[9]
      ).to.equal(true);

      // result = 2 (노쇼)
      expect(
        depositInfo[10]
      ).to.equal(2);

      /*
       * 평판:
       * 100 → 80
       *
       * 노쇼 횟수:
       * 0 → 1
       */
      const [
        ,
        score,
        noShowCount,
      ] =
        await reputation.getUser(
          consumer.address
        );

      expect(score).to.equal(80);
      expect(
        noShowCount
      ).to.equal(1);

      // 정산 후 컨트랙트 잔액 0
      expect(
        await deposit.getContractBalance()
      ).to.equal(0);
    });
  });

  describe("노쇼 후 정상 이행", function () {
    it("노쇼 이후 정상 예약을 이행하면 평판이 80에서 84로 회복된다", async function () {
      const {
        reputation,
        deposit,
        consumer,
        seller,
      } = await loadFixture(
        deployShowUpFixture
      );

      const amount =
        ethers.parseEther("0.01");

      /*
       * 첫 번째 예약: 노쇼
       */
      const first =
        await createReservation({
          deposit,
          consumer,
          seller,
          appointmentId: 10,
          amount,
        });

      await time.increaseTo(
        first.reservationTime
      );

      await deposit
        .connect(seller)
        .confirmBySeller(10);

      await time.increase(
        20 * 60 + 1
      );

      await deposit
        .connect(seller)
        .settleNoShow(10);

      let [
        ,
        score,
        noShowCount,
      ] =
        await reputation.getUser(
          consumer.address
        );

      expect(score).to.equal(80);
      expect(
        noShowCount
      ).to.equal(1);

      /*
       * 두 번째 예약: 정상 이행
       */
      const second =
        await createReservation({
          deposit,
          consumer,
          seller,
          appointmentId: 11,
          amount,
        });

      await time.increaseTo(
        second.reservationTime
      );

      await deposit
        .connect(seller)
        .confirmBySeller(11);

      await deposit
        .connect(consumer)
        .confirmByConsumer(11);

      await deposit
        .connect(consumer)
        .settleVisited(11);

      [
        ,
        score,
        noShowCount,
      ] =
        await reputation.getUser(
          consumer.address
        );

      /*
       * 80 → 84
       *
       * 누적 노쇼 횟수는 1 유지
       */
      expect(score).to.equal(84);
      expect(
        noShowCount
      ).to.equal(1);
    });
  });
});