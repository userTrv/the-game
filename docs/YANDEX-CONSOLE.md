# Данные для консоли Яндекс Игр

Готовые значения для черновика игры в консоли разработчика. Тексты в блоках копируются как есть, лимиты
проверены с запасом на переносы строк. Как собрать архив и что проверить перед модерацией — в [YANDEX.md](YANDEX.md).

## Файлы

| Что | Где | Как получить |
|---|---|---|
| Архив игры | `apps/client/shellter-yandex.zip` | `pnpm --filter @shellter/client build:yandex` |
| Иконка 512×512 | `tools/yandex/promo/icon-512.png` | `pnpm --filter @shellter/art run promo` |
| Обложка 800×470 | `tools/yandex/promo/cover-800x470.png` | та же команда |

Иконка и обложка собраны из спрайтов игры (`tools/yandex/promo.ts`): рак в раковине с жильцами на фоне
лагуны, на обложке ещё обитатели заводи. Это не скриншот, без рамок, скруглений, интерфейса и текста
(требования 5.6, 8.3.3, 8.3.4). Скриншоты для страницы игры снимать из настоящей игры (5.1.1.2).

## Общие настройки

| Поле | Значение |
|---|---|
| Версия | `0.1.0` (из `apps/client/package.json`) |
| Поддерживаемые платформы | Десктоп, мобильные устройства (телефоны и планшеты) |
| Ориентация | Любая. Основная — портретная; в альбомной и на десктопе сцена растягивается по ширине, интерфейс остаётся колонкой посередине |
| Игра переведена на | русский (ru), английский (en) |
| Игра использует облачные сохранения | Включить |
| Возрастной рейтинг | 0+ |
| Категории | Казуальные, Стратегии |
| Теги | автобой, подводный мир, рогалик, мерж, коллекционирование, спокойная |

Почему 0+: нет крови, смерти персонажей, страшных сцен, грубой лексики и азартных механик. Бой — существа
с глазками толкают друг друга и теряют полоску здоровья; поражение заканчивается возвращением на риф. Покупок
нет, реклама только от Яндекса. Чат и общения между игроками нет.

Про категории: «Казуальные» — основная (короткие забеги, спокойный темп), «Стратегии» — за сборку жильцов
и автобой. Если в списке консоли есть «Для всей семьи», её можно добавить третьей.

## Русский

Название (8 из 50):

```text
Shellter
```

Описание для SEO (до 160):

```text
Рак-отшельник ест обитателей заводей, растёт и собирает на раковине живой риф. Жильцы сливаются и сами сражаются со стражами глубин.
```

Короткое описание (до 70):

```text
Рак-отшельник собирает живой риф на своей раковине
```

Об игре (до 1000):

```text
Маленький рак-отшельник спускается в подводные заводи. Мелкие существа — еда, крупные кусаются. От них можно спрятаться в раковину, но тогда рак не ест.

Чем больше съедено, тем крупнее рак и его раковина. На раковине селятся жильцы: актинии, кораллы, морские ежи, светящиеся грибы и другие. Их выбирают на привалах между заводями. Три одинаковых жильца сливаются в одного, более сильного, а жильцы одного рациона вместе дают бонус.

Каждую третью заводь охраняет страж. Бой идёт сам: рак и жильцы дерутся без участия игрока, всё решает собранная раковина.

На привале нужно решить, нырять глубже или вынести добычу. После поражения остаётся только часть собранного.

Кораллы и блёстки из забегов идут на риф: маяк открывает дорогу глубже, сад и мастерская дают новых жильцов и раковины, в гроте мутаций рак получает новые клешни, панцирь, ноги и усики.

Четыре биома: солнечная лагуна, затонувший корабль, светящаяся бездна и глубинный разлом.
```

Как играть (до 1000):

```text
Заводь. Зажми палец на экране или кнопку мыши и веди — рак ползёт к точке нажатия. Можно управлять стрелками или WASD. Отпустишь палец, кнопку или клавиши — рак спрячется в раковину: укусы не проходят, но и есть он не может. Пробел тоже прячет рака, не отпуская стрелок. Если спрятаться в момент, когда хищник замер перед укусом, укус будет отбит.

Ешь существ меньше себя, на крупных не нарывайся. Постой рядом с жемчужницей или сундуком, чтобы забрать жемчуг. Через несколько секунд можно идти дальше кнопкой «Дальше».

Привал. Выбери одного жильца, мутацию или лечение. Жемчуг тратится в лавке. Три одинаковых жильца сливаются сами. Кнопка «Переселить» передвигает жильца в другой слот. Здесь же решается, нырять глубже или вынести добычу.

Страж. Бой идёт сам, его можно ускорить.

Между забегами на рифе строятся и улучшаются постройки.

Esc открывает настройки и ставит заводь на паузу, повторное нажатие закрывает окно.
```

## English

Title (8 of 50):

```text
Shellter
```

SEO description (up to 160):

```text
A hermit crab eats its way through tide pools, grows and carries a living reef on its shell. Tenants merge and fight the deep guardians on their own.
```

Short description (up to 70):

```text
A hermit crab grows a living reef on its shell
```

About the game (up to 1000):

```text
A small hermit crab dives into underwater pools. Small creatures are food, big ones bite. The crab can hide in its shell, but then it can't eat.

The more it eats, the bigger the crab and its shell get. Tenants settle on the shell: anemones, corals, urchins, glowing mushrooms and more. You pick them at camps between pools. Three identical tenants merge into a stronger one, and tenants of the same diet give a set bonus.

Every third pool has a guardian. The battle is automatic: the crab and its tenants fight on their own, and the shell you built decides it.

At camp you decide whether to dive deeper or carry the loot out. A defeat keeps only part of what you collected.

Coral and shine from runs go into the reef: the lighthouse opens the way deeper, the garden and the workshop bring new tenants and shells, and the mutation grotto gives the crab new claws, carapace, legs and antennae.

Four biomes: the sunny lagoon, the sunken ship, the glowing abyss and the deep trench.
```

How to play (up to 1000):

```text
Pool. Press and hold a finger or the mouse button and drag: the crab crawls towards the pointer. Arrow keys or WASD also work. Let go of the screen, the button or the keys and the crab hides in its shell: bites don't get through, but it can't eat either. Space also hides the crab without letting go of the arrows. Hiding right when a predator freezes before a bite parries it.

Eat creatures smaller than you and stay away from big ones. Stay next to an oyster or a chest to collect pearls. After a few seconds you can move on with the Onward button.

Camp. Pick one tenant, mutation or heal. Pearls are spent in the shop. Three identical tenants merge on their own. The Move button puts a tenant into another slot. This is also where you decide whether to dive deeper or carry the loot out.

Guardian. The battle plays out on its own; you can speed it up.

Between runs, build and upgrade the reef.

Esc opens the settings and pauses the pool; press it again to close.
```

## Ключевые слова (до 100, через запятую)

Русский:

```text
рак-отшельник, риф, подводный мир, автобой, мерж, рогалик, раковина, море
```

English:

```text
hermit crab, reef, underwater, autobattler, merge, roguelite, shell, ocean
```
