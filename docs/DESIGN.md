# Village Crown: game design

What the game is meant to become, and the order to build it in. ARCHITECTURE.md says how the code
is put together; this says what the game is for. Numbers are first guesses: balance lives in
`src/game/balance.ts`, and the human tunes it.

## The idea in one paragraph

You ride through your village as its lord. Your people need things: bread and water first, then
cheese, meat and warm clothes, then ale, candles and pastries. Meet a household's needs and its
house moves up, its family works better and the village grows; leave them unmet and they slow down
and in the end move away. Every need is met by a chain of real work you can watch: a farmer cuts
hay, a serf carries it to the cow farm, the keeper feeds the cows, a pail of milk goes to the dairy,
cheese goes into a store, and a family fetches it home. The castle on the hill sets you goals and
grants charters; the market's merchant trades what you can't make.

## Pillars

1. **Nothing jumps.** Every good lies somewhere and moves only in someone's arms (ARCHITECTURE.md).
   The economy is something you see, not a number.
2. **People, not points.** Goods exist to meet the needs of real villagers with homes. A chain
   that feeds no one is not finished.
3. **Winter comes.** Three days in every twelve are winter. Then nothing grows, animals don't
   graze, and people live on what was stored. Fresh food spoils; kept food lasts. This is why
   chains go on past their raw goods, and why the nine days before are spent laying in.
4. **Land is the scarce thing.** Fields, pasture and building plots all want the same cells inside
   the road grid's squares. Choosing what goes where is the strategy.
5. **Every step playable.** Each stage below works on its own and leaves the game better.

## Where it stands now

Built: houses, storage yards, serfs carrying goods, builders, roads and crossroads; the farm
(grain and hay), mill (flour), bakery (bread, with water), well (water drawn by hand), tavern (the
hungry eat its bread); woodcutter (logs), sawmill (planks), stonecutter (stone); chicken, cow, sheep and horse
farms (herds with sexes and ages in years; eggs, milk, wool, meat; horses on pasture).

Not used yet: milk, wool, eggs, meat. The market, blacksmith, chapel and watchtower have no work.
Houses don't need anything.

## 1. Needs and spoilage (built: households.ts, spoilage.ts; winter in daynight.ts)

- **Where people live.** Someone in a lasting job lives at their workplace (the farmer at the
  farm, the baker at the bakery); serfs, builders and townsfolk in houses,
  going home to sleep at night; the monks in the chapel.
- **Hunger (built: hunger.ts).** Everyone carries a few days of food in them, a day used up a
  day. Hungry, they eat at home if there is food there, else at the tavern's bench; starving,
  they put down their work and eat whatever food is nearest, anywhere; long starving, they leave.
  Every home has a pantry by the door that serfs keep in bread, so its people eat without a walk.
- **Households.** Each house's family has needs by the house's level and drinks and burns from its own small
  store (a shelf by the door); its need for food is met while nobody in it is hungry. A family member walks to the nearest place that has what they lack
  (a yard, a workshop's store, the market) and carries it home, like any errand.
- **Needs met → happiness.** A household's happiness is how well its needs were met over the last
  few days. Happy: works at full speed, has children (new villagers). Unhappy: works slower. Long
  unhappy: people leave one by one, down the road out of the village, the unhappiest household's
  first, until those left are content again; an empty house stands empty until new people come.
- **Winter: days 10–12 of every 12.** The fields lie fallow under snow, animals stay in and eat
  only stored feed, and families live on their stores. Days 1–9 are for laying in.
- **Spoilage.** Fresh goods keep about a day (milk sours, eggs and meat go off); a spoiled item
  is thrown away where it lies. Kept goods (flour, bread for a day or two, cheese, smoked meat,
  cloth) last. Storage yards keep only goods that keep.

First needs: **cottage**: bread, water.

## 2. Keeping food: dairy, smokehouse, weaver (built)

| Workshop | From | Makes | Notes |
| --- | --- | --- | --- |
| Dairy | milk | cheese | 2 pails → 1 cheese; cheese keeps all winter |
| Smokehouse | meat (+ salt later) | smoked meat | keeps; sausages a later recipe |
| Weaver | wool | cloth | cloth → clothing for families |

New house level: **farmstead** (freemen): + cheese or smoked meat, + clothing before each winter (or someone
falls ill and stays in bed). Freemen can take skilled jobs (smith, weaver).

## 3. What an animal leaves: hides and tallow (built)

Butchering gives meat **and** a hide **and** tallow. This makes the end of an animal's life a
choice: an old cow still gives milk, a young one butchered gives meat and leather now.

| Workshop | From | Makes |
| --- | --- | --- |
| Tannery | hides | leather (needs water) |
| Chandler | tallow | candles |
| Saddler | leather | harness, saddles |

Candles let a household and a workshop work on after dark, at the cost of candles; most wanted in
winter.

## 4. Horses at work (built: carts.ts)

- **Carts.** A serf with a horse and harness carries four items a trip instead of one. The horse
  comes from the horse farm, grown; it lives in the transport hub's stable and eats hay.
- **Plough horses.** A farm with a horse works more fields (the upgrade's second farmer becomes a
  horse and plough). Hay feeds it, so fields feed fields.
- Pasture keeps its weight: horses need green land, and land is scarce (pillar 4).

## 5. The castle (built: castle.ts)

The castle on the hill sends a request every few years: "20 cheese and 4 grown horses by
day 12", later a yearly tithe. Meeting one earns a **charter**: it unlocks the next house level
and its buildings (this is the game's tech tree), plus coin. Failing costs standing, and low
standing means harder requests. The rider rides up to the castle road to take a request and to
deliver (serfs carry the goods there).

Next house level: **townhouse** (burghers): + ale, candles, pastries (eggs and flour at the
bakery), the chapel within reach. Burghers pay taxes in coin.

## 6. The market and the merchant (built: market.ts)

A merchant comes on market days. He sells what the village can't make (iron for the
blacksmith's tools, which speed up every worker; salt for the smokehouse; spices) and buys
surplus (wool, cloth, cheese). Prices move with what you sell him. The blacksmith gets work:
iron → tools.

## As built: simplifications to revisit

- Candles are a burgher need only; they don't yet let anyone work after dark.
- Clothing is cloth used up through the year (a cloth a person a year), not a yearly change of
  clothes with illness when missing.
- The farm's plough horse eats nothing; stabled horses eat hay.
- The castle's requests are a fixed list, then the last again, half as much again each time.
  Standing only counts up and down; it changes nothing yet.
- The merchant has fixed prices; spices are not sold. Coin is only counted (taxes, castle,
  merchant); nothing but iron and salt costs coin yet.
- Brewery and pastry cook are built (they were parked), because the townhouse needs ale and
  pastries.
- Families still don't fetch their own goods; serfs bring everything (except that the hungry go to
  their food).
- A loaf is a day's food for anyone (`FOODS`), a first guess: three times the bread the old
  household need used. Hunger doesn't slow anyone's work yet.

## Ideas parked for later

- Brewery (grain → ale), for the tavern and the burghers.
- Spring and harvest time between the winters (sowing early, a harvest festival).
- The watchtower: wolves at the woods' edge go for the chickens and sheep at night.
- Ageing people the same way as animals (children grow up, the old retire).
- Weather years: a dry year, a hard winter.

## Decided

- Winter is 3 days in every 12 (days 10–12).
- Unhappy households lose people one by one, not a whole house at once.

## Open questions for the human

- Animals age a year every game day, but the seasons go round every twelve days. Keep both as
  they are, or make a year twelve days (ages would then go twelve times slower)?
- Coin: only from taxes and trade, or also for building?
- Should the castle's requests be authored (a campaign) or generated (endless)?
