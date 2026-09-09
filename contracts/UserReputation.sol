// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract UserReputation {
    struct UserInfo {
        string name;
        uint256 reputation;
        uint256 noShowCount;
        bool isRegistered;
    }

    address public admin;

    // 기존 평판 반영 비율: 80%
    uint256 public constant ALPHA = 80;
    uint256 public constant SCALE = 100;

    mapping(address => UserInfo) public users;
    mapping(address => bool) public authorizedUpdaters;

    event UserRegistered(address indexed user, string name);
    event UserRewarded(address indexed user, uint256 reputation);
    event NoShowRecorded(
        address indexed user,
        uint256 reputation,
        uint256 noShowCount
    );
    event AuthorizedUpdaterChanged(address indexed updater, bool allowed);

    modifier onlyAdminOrUpdater() {
        require(
            msg.sender == admin || authorizedUpdaters[msg.sender],
            "not allowed"
        );
        _;
    }

    constructor() {
        admin = msg.sender;
    }

    function register(string calldata _name) external {
        require(!users[msg.sender].isRegistered, "already registered");

        users[msg.sender] = UserInfo({
            name: _name,
            reputation: 100,
            noShowCount: 0,
            isRegistered: true
        });

        emit UserRegistered(msg.sender, _name);
    }

    function setAuthorizedUpdater(
        address _updater,
        bool _allowed
    ) external {
        require(msg.sender == admin, "not admin");
        require(_updater != address(0), "invalid updater");

        authorizedUpdaters[_updater] = _allowed;

        emit AuthorizedUpdaterChanged(_updater, _allowed);
    }

    // 정상 예약 이행
    function rewardUser(
        address _user
    ) external onlyAdminOrUpdater {
        require(users[_user].isRegistered, "user not registered");

        _updateReputation(_user, 100);

        emit UserRewarded(
            _user,
            users[_user].reputation
        );
    }

    // 노쇼 발생
    function recordNoShow(
        address _user
    ) external onlyAdminOrUpdater {
        require(users[_user].isRegistered, "user not registered");

        users[_user].noShowCount += 1;

        _updateReputation(_user, 0);

        emit NoShowRecorded(
            _user,
            users[_user].reputation,
            users[_user].noShowCount
        );
    }

    // R(t+1) = alpha * R(t) + (1-alpha) * B(t)
    function _updateReputation(
        address _user,
        uint256 _behaviorScore
    ) private {
        uint256 currentReputation =
            users[_user].reputation;

        users[_user].reputation =
            (
                currentReputation * ALPHA +
                _behaviorScore * (SCALE - ALPHA)
            ) / SCALE;
    }

    function getUser(
        address _user
    )
        external
        view
        returns (
            string memory name,
            uint256 reputation,
            uint256 noShowCount,
            bool isRegistered
        )
    {
        UserInfo memory user = users[_user];

        return (
            user.name,
            user.reputation,
            user.noShowCount,
            user.isRegistered
        );
    }
}