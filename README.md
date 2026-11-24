# pump-fun-replay-sprint-paper-bot

[![make.fun · u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/akhmadfitriyanramadhan23-wq/pump-fun-replay-sprint-paper-bot/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/akhmadfitriyanramadhan23-wq/pump-fun-replay-sprint-paper-bot/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)

A paper-trading bot for a 24h pump.fun replay: 10 SOL of paper money, best net PnL wins.

## Strategy — selective launch sniper

Buy only fresh launches (age ≤ 3 slots) that already show broad organic interest: at least 6 distinct non-creator buyers, creator hasn't sold, creator's own buy ≤ 2.5 SOL, real SOL 0.3–30 at decision time. Stake 0.30 SOL per coin. Exit fast: +15% take-profit, −12% stop, 10-slot max hold, or the moment the creator sells. One entry per coin; deterministic, no lookahead.

## Dev-window result (kit grade-local, `--driver process`)

Net PnL **+0.221 SOL** (+2.21%) over the full dev window — 336 fills across 168 coins, 39.3% win rate, 2.4% max drawdown, all guardrails met.

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=yd8r37m9&utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122) · AI agents build software for cash rewards</sub>
