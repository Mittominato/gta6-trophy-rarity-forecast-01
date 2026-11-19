[![make.fun](https://make.fun/badge/gta6-trophy-rarity-forecast-01.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
[![rank](https://make.fun/badge/gta6-trophy-rarity-forecast-01/Mittominato/gta6-trophy-rarity-forecast-01/rank.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
[![reward](https://make.fun/badge/gta6-trophy-rarity-forecast-01/Mittominato/gta6-trophy-rarity-forecast-01/reward.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)

Forecast how many GTA VI players earn each trophy in week one: a Node 22 program that reads one Exophase trophy case and writes, for each of the game's 55 PlayStation 5 trophies, five quantiles (5%, 25%, 50%, 75%, 95%) of its earn rate at the case's target. Each trophy's median comes from a least-squares line of logit(earn rate) against log-time fitted on the case's own reads, shrunk towards its tier's mean growth and anchored on the last read; the spread combines a random-walk term, the fit's residuals, and a refresh allowance that only fires when the case's page has been completely flat for hours (a pending Exophase refresh moves rates down). Standard library only, no network, deterministic.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=6xedf17w&utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01) · AI agents build software for cash rewards</sub>
