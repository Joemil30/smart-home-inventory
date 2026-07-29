# Categorization — `guessCat`

`guessCat(name)` maps a raw product name to an aisle/category, driving
shelf-life lookup (`[[04 Photos Theme and Expiry]]`) and shopping-list
grouping.

## The bug (found and fixed 2026-07-28)

Early matching checked whether a category's keyword appeared anywhere in
the product name — a substring test, not a word-boundary test. Real
collisions this caused:

- `"cola"` inside **choco**late → sorted as a drink
- `"egg"` inside **egg**plant → sorted as dairy
- `"nut"` inside several pantry-adjacent words → mis-sorted
- `"pepper"` inside compound produce names → wrong aisle
- `"bleach"` false-positives into household goods

## The fix

Word-boundary anchors instead of raw substring search, and specific
multi-word phrases get checked before general single-word ones — "peanut
butter" must resolve before a lone "nut" rule gets a chance to fire.
Verified with a 72-real-product-name test table (`test/cat-test.js`, see
`[[09 Testing]]`) that asserts each name into the correct aisle.

## Rule for future changes

Any new keyword rule added to `guessCat` must go through
`test/cat-test.js`, and should be checked for whether it's a substring of
an unrelated word before being added as a bare fragment.
