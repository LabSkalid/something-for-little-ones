import fs from 'node:fs';
import path from 'node:path';

const root = 'D:/KIDS/site/src/content/sheets';

/** [description, parentNote or null to leave the note] */
const copy = {
  'christmas-coloring-pages/christmas-stocking.md': [
    'A cuff, a heel, a toe, and a little holly at the top. The shortest Christmas page, for about ages 3 to 4.',
    null,
  ],
  'christmas-coloring-pages/reindeer.md': [
    'Antlers and a round nose, usually the red one. The face itself is one big shape, for about ages 3 to 4.',
    null,
  ],
  'christmas-coloring-pages/gingerbread-house.md': [
    'Icing, candies, and a door. This is the busy Christmas page, for a child around 3 or 4 who likes small pieces.',
    null,
  ],
  'christmas-coloring-pages/christmas-tree.md': [
    'Ornaments, a star, and two gifts. The tree sections are big. The ornaments are the part they want in different colors. For about ages 3 to 4.',
    null,
  ],
  'christmas-coloring-pages/santa-claus.md': [
    'Just the face: a hat, a beard, and a mustache. It finishes faster than the tree. For about ages 3 to 4.',
    null,
  ],
  'halloween-coloring-pages/black-cat.md': [
    'A curled tail and a low fence. Black, orange, or gray all work. For about ages 3 to 4.',
    null,
  ],
  'fall-coloring-pages/apple-basket.md': [
    'A basket of apples, plus one apple and a leaf beside it. Mix red, green, and yellow. For about ages 3 to 4.',
    null,
  ],
  'fall-coloring-pages/scarecrow.md': [
    'A floppy hat and patched clothes. Shirt, pants, and hat can each be a different color. For about ages 3 to 4.',
    null,
  ],
  'halloween-coloring-pages/witch-hat.md': [
    'A tall hat with a buckle, and a small cat beside the brim, not on a broom. For about ages 3 to 4.',
    null,
  ],
  'fall-coloring-pages/acorn.md': [
    'A big nut, a cap of little scales, and a small oak leaf. The nut is the easy fill. For about ages 3 to 4.',
    null,
  ],
  'fall-coloring-pages/maple-leaf.md': [
    'Five big lobes and a short stem. One red or one yellow covers it. For about ages 3 to 4.',
    null,
  ],
  'princess-coloring-pages/pony-with-ribbon.md': [
    'A ribbon in the mane. A storybook pony, not a toy from a store. For about ages 3 to 4.',
    null,
  ],
  'princess-coloring-pages/crown-and-wand.md': [
    'A crown, a star wand, and a few stars. The short page in the princess pile. For about ages 3 to 4.',
    null,
  ],
  'princess-coloring-pages/storybook-princess.md': [
    'A full gown and a crown. Not a character from a movie. The skirt is the big area. For about ages 3 to 4.',
    null,
  ],
  'princess-coloring-pages/royal-carriage.md': [
    'Two big wheels and a curtain in the window. Kids usually color the wheels first. For about ages 3 to 4.',
    null,
  ],
  'princess-coloring-pages/fairy-tale-castle.md': [
    'Three towers, a door, and windows. The flag has no emblem on it. For about ages 3 to 4.',
    null,
  ],
  'halloween-coloring-pages/candy-bag.md': [
    'A lollipop and wrapped sweets. No brand name on the bag, so every candy can be its own color. For about ages 3 to 4.',
    null,
  ],
  'halloween-coloring-pages/friendly-ghost.md': [
    'A smile and a tiny pumpkin. For a child who wants Halloween and does not want a scare. About ages 3 to 4.',
    null,
  ],
  'halloween-coloring-pages/jack-o-lantern.md': [
    'A wide smile, a stem, and a leaf. The ribs are wide enough for a big orange crayon. For about ages 3 to 4.',
    null,
  ],
  'fall-coloring-pages/squirrel.md': [
    'A curled tail and an acorn in its paws. Two browns are enough. For about ages 3 to 4.',
    null,
  ],
  'dinosaur-coloring-pages/stegosaurus.md': [
    'Plates along the back and a spiked tail. Each plate can be its own color, or two colors taking turns. For about ages 3 to 4.',
    null,
  ],
  'car-coloring-pages/dump-truck.md': [
    'The bed is tipped up, with a few rocks in it. That triangle is easier than a flat side. For about ages 3 to 4.',
    null,
  ],
  'dinosaur-coloring-pages/friendly-trex.md': [
    'A smile, tiny arms, and a few spots. The smile is a curve, not a row of teeth. For about ages 3 to 4.',
    null,
  ],
  'car-coloring-pages/family-car.md': [
    'Round wheels and open windows. The simplest vehicle in this pile. For about ages 3 to 4.',
    null,
  ],
  'dinosaur-coloring-pages/dinosaur-egg.md': [
    'A baby peeking out, plus two smaller eggs for a sibling on the same sheet. The quiet dinosaur page. For about ages 3 to 4.',
    null,
  ],
  'dinosaur-coloring-pages/triceratops.md': [
    'A wide frill and three horns. The horns are rounded on purpose. For about ages 3 to 4.',
    null,
  ],
  'animal-coloring-pages/puppy.md': [
    'Floppy ears and one spot. The head and body are big enough for a crayon. For about ages 3 to 4.',
    null,
  ],
  'animal-coloring-pages/elephant.md': [
    'Big ears and a curled trunk. One animal that fills the paper. For about ages 3 to 4.',
    null,
  ],
  'animal-coloring-pages/bunny.md': [
    'Tall ears and a fluffy tail. The inner ears can be pink while the rest is another color. For about ages 3 to 4.',
    null,
  ],
  'car-coloring-pages/pickup-truck.md': [
    'An open bed and chunky wheels. The bed is empty on purpose, so there is a big space to color. For about ages 3 to 4.',
    null,
  ],
  'animal-coloring-pages/kitten.md': [
    'Pointy ears and a striped tail. The whiskers are there to look at, not to fill in. For about ages 3 to 4.',
    null,
  ],
  'animal-coloring-pages/butterfly.md': [
    'Four wings, split into sections. This is the long one in the animal pile. A younger child can still color each wing one shade. For about ages 3 to 4.',
    null,
  ],
  'car-coloring-pages/fire-truck.md': [
    'A ladder, a hose, and large wheels. Most kids color the body red and then hunt for something else to do. For about ages 3 to 4.',
    null,
  ],
  'car-coloring-pages/race-car.md': [
    'A spoiler and a stripe. No number and no brand mark, so it can be any color. For about ages 3 to 4.',
    null,
  ],
  'dinosaur-coloring-pages/brachiosaurus.md': [
    'A long neck reaching for leaves. Kids who name dinosaurs can call this the long-neck. For about ages 3 to 4.',
    null,
  ],
  'thanksgiving-coloring-pages/harvest-path.md': [
    'A path through corn and wheat, with a turkey farther along. This one takes a while. For about ages 6 to 8.',
    'Start on the path, the leaf veins and the wheat. The turkey and the pumpkin can wait until that looks started.',
  ],
  'thanksgiving-coloring-pages/patterned-cornucopia.md': [
    'A woven basket tipped full of harvest food, with leaves drawn in. For about ages 6 to 8.',
    'The weave and the leaf veins are the slow part. The pumpkin and the apples are the easy big shapes if you want a quick win first.',
  ],
  'thanksgiving-coloring-pages/feast-table.md': [
    'A feast on a cloth with a diamond pattern. For a longer sitting, about ages 6 to 8.',
    'Do the turkey and the pie first so the page looks started. The diamond cloth is the part that takes the afternoon.',
  ],
  'thanksgiving-coloring-pages/harvest-porch.md': [
    'Steps, a basket, and wheat. A small porch scene for about ages 5 to 6.',
    'The basket and the wheat are the real color job. The steps can stay one color.',
  ],
  'thanksgiving-coloring-pages/turkey-and-leaves.md': [
    'A turkey with corn and leaves around it. Each leaf can be a different color. For about ages 5 to 6.',
    'Color the leaves if you have time for a few colors. If you are running out of sitting, do the turkey and stop.',
  ],
  'thanksgiving-coloring-pages/dinner-table.md': [
    'A turkey, a pie, and plates on a table. A small dinner scene for about ages 5 to 6.',
    'The turkey and the pie are the foods to do first. The plates can all be the same color.',
  ],
  'thanksgiving-coloring-pages/mashed-potatoes.md': [
    'A bowl of mashed potatoes, a spoon, and a pat of butter. For about ages 4 to 5.',
    'The potatoes are the big fill. The spoon and the butter are the small pieces after that.',
  ],
  'thanksgiving-coloring-pages/cranberry-bowl.md': [
    'A bowl of cranberries, each berry its own circle, with a few leaves. For about ages 4 to 5.',
    'The bowl is the big shape. Each berry is a little circle, which is either the fun part or the part you skip.',
  ],
  'thanksgiving-coloring-pages/wheat-sheaf.md': [
    'A bundle of wheat tied with a ribbon. The grain can all be one color. For about ages 4 to 5.',
    'Color the heads of grain one color if you want it done. The ribbon is the small extra.',
  ],
  'thanksgiving-coloring-pages/huge-corn.md': [
    'One huge ear of corn and a leaf. Two colors and you are done. For a child about 2 or 3 who still scribbles.',
    'The cob and the leaf are the only two jobs. There is nothing else hiding on the page.',
  ],
  'thanksgiving-coloring-pages/huge-pie.md': [
    'One huge pie. The filling is the big area, and the crust is the rim. For about ages 2 to 3.',
    'Fill the pie. The crust is the only extra piece, and it can wait.',
  ],
  'thanksgiving-coloring-pages/huge-turkey.md': [
    'One huge turkey, big enough to scribble across. For about ages 2 to 3.',
    'The body is one big area. The three feathers can all be the same color.',
  ],
  'thanksgiving-coloring-pages/harvest-basket.md': [
    'A basket of harvest food. Pumpkin and apples first, if you are choosing colors. For about ages 3 to 4.',
    'Pick the pumpkin and the apples first. The bands of the basket can stay one color.',
  ],
  'thanksgiving-coloring-pages/cornucopia.md': [
    'A horn with three foods spilling out. For about ages 3 to 4.',
    'Color the three foods first. The horn is the big shape left at the end.',
  ],
  'thanksgiving-coloring-pages/ear-of-corn.md': [
    'An ear of corn with two husk leaves. The cob is one color. For about ages 3 to 4.',
    'Do the cob in one color. The two husk leaves are the other job.',
  ],
  'thanksgiving-coloring-pages/pumpkin-pie.md': [
    'A whole pumpkin pie and a leaf. The wedges of filling are the main job. For about ages 3 to 4.',
    'Color the filling wedges first. The dish and the leaf can share a second color.',
  ],
  'thanksgiving-coloring-pages/friendly-turkey.md': [
    'One turkey with a fan of tail feathers. Thick lines, for about ages 3 to 4.',
    'The body is the big area. Each tail feather can be its own color, or all one color if they are done.',
  ],
  'first-animal-coloring-pages/simple-bird.md': [
    'One bird: a body, a wing, and a tail. A few huge shapes, for about ages 2 to 3.',
    'Color the body first. The wing and the tail can be a second color if they are still interested.',
  ],
  'christmas-coloring-pages/winter-woods.md': [
    'A deer in the woods, with snow on the branches. A longer picture, for about ages 6 to 8.',
    'The snow shapes on the branches repeat. Get a little of that going, then the deer.',
  ],
  'fall-coloring-pages/forest-floor.md': [
    'Mushrooms, leaves, and a squirrel on the forest floor. For about ages 6 to 8.',
    'The mushroom spots and the leaves are the pattern. If time runs out, the squirrel can wait.',
  ],
  'halloween-coloring-pages/cookie-table.md': [
    'A plate of patterned cookies. For a longer Halloween sitting, about ages 6 to 8.',
    'Pick one cookie shape and color all of those first. The icing dots can share one color across the plate.',
  ],
  'christmas-coloring-pages/snowy-village.md': [
    'Houses, a tree, and snowflakes. Two colors for the houses is enough. For about ages 6 to 8.',
    'The snowflakes repeat. The houses can share two colors so you are not inventing a new one for every wall.',
  ],
  'fall-coloring-pages/autumn-barn.md': [
    'A barn with a quilt pattern on it. The stars in the quilt are the slow part. For about ages 6 to 8.',
    'Do the quilt stars if they like a pattern. The barn is the big shape after that.',
  ],
  'halloween-coloring-pages/night-garden.md': [
    'Pumpkins, an owl, and a moon. Not a scary night. For about ages 6 to 8.',
    'Two colors taking turns on the pumpkin patterns is enough of a plan. The moon and the owl are the big shapes after that.',
  ],
  'christmas-coloring-pages/living-room.md': [
    'A tree, gifts, and a rug in a living room. For a longer sitting, about ages 6 to 8.',
    'The ornaments and the rug are the patterns. Color one kind of ornament all the way around the tree before you start the gifts.',
  ],
  'fall-coloring-pages/orchard-path.md': [
    'Trees and baskets along an orchard path. Color the apples first so it looks started. For about ages 6 to 8.',
    'The apples make the page look started. The path and the fence can wait.',
  ],
  'halloween-coloring-pages/patterned-porch.md': [
    'A porch with a patterned rug and pumpkins. The rug is the long part. For about ages 6 to 8.',
    'The rug and the pumpkin patterns take the time. The cat can be one color at the end.',
  ],
  'christmas-coloring-pages/reindeer-and-tree.md': [
    'One reindeer beside a tree with ornaments. A small scene for about ages 5 to 6.',
    'The reindeer is the big animal. The ornaments are the pattern on the tree.',
  ],
  'fall-coloring-pages/hay-wagon.md': [
    'A hay wagon with a pumpkin beside it. For about ages 5 to 6.',
    'The wagon and the hay are the big areas. The pumpkin and the leaves are the extras.',
  ],
  'halloween-coloring-pages/pumpkin-path.md': [
    'Three pumpkins along a path, with flowers. For about ages 5 to 6.',
    'The pumpkins repeat, so do those first. The flowers and the fence are what is left.',
  ],
  'fall-coloring-pages/porch-mums.md': [
    'Steps, two pots of mums, and a wreath. For about ages 5 to 6.',
    'The two pots are the main job. The wreath and the steps can take whatever crayons are left.',
  ],
  'christmas-coloring-pages/window-wreath.md': [
    'A wreath in a window, with a candle and a little snow. For about ages 5 to 6.',
    'The wreath is the main shape. The bow, the candle, and the snow circles are the smaller jobs.',
  ],
  'halloween-coloring-pages/moon-bats.md': [
    'A moon and three friendly bats. They can all be the same color. For about ages 5 to 6.',
    'Each bat can match. Save the moon for the end if you want one big shape left.',
  ],
  'fall-coloring-pages/apple-tree.md': [
    'An apple tree, a basket, and a fence. The apples are the part that repeats. For about ages 5 to 6.',
    'Color the apples first, then the tree and the basket.',
  ],
  'christmas-coloring-pages/fireplace.md': [
    'A fireplace with stockings and a small tree. For about ages 5 to 6.',
    'The two stockings and the ornaments repeat. The fireplace can be one color after those.',
  ],
  'halloween-coloring-pages/pumpkin-porch.md': [
    'A door, two pumpkins, and a cat. A small porch for about ages 5 to 6.',
    'Start with the two pumpkins. The cat and the lantern are the smaller pieces.',
  ],
  'christmas-coloring-pages/gift-sleigh.md': [
    'A sleigh with two gifts and curved runners. For about ages 4 to 5.',
    'The sleigh body is the big shape. The two gifts are the extra colors.',
  ],
  'fall-coloring-pages/pumpkin-pie.md': [
    'A slice of pumpkin pie and three leaves. For about ages 4 to 5.',
    'The filling is the big area. The crust and the leaves are the smaller pieces.',
  ],
  'halloween-coloring-pages/halloween-owl.md': [
    'An owl in a hat. Friendly, not scary. For about ages 4 to 5.',
    'The body and the hat are the two main colors. The feathers are a few extra shapes, not a fine pattern.',
  ],
  'woodland-animal-coloring-pages/woodland-squirrel.md': [
    'A squirrel with a patterned tail, and a few leaves. For about ages 6 to 8.',
    'The tail sections are the pattern to do first. The acorn and the leaves are smaller after that.',
  ],
  'dinosaur-scene-coloring-pages/flying-reptile.md': [
    'A flying reptile with wing panels. The cloud and the tree can stay white. For about ages 5 to 6.',
    'The wing panels are the pattern. The cloud and the tree top are background, and they can stay the color of the paper.',
  ],
  'christmas-coloring-pages/snowman.md': [
    'Three balls, a hat, and a scarf. The snow can stay white. For about ages 4 to 5.',
    'Each ball can stay white or get a light color. The hat and the scarf are the parts that need a color.',
  ],
  'fall-coloring-pages/leaf-pile.md': [
    'Three big leaves in a pile. Each one can be its own color. For about ages 4 to 5.',
    'Give each leaf its own color if you want. Where they overlap is still a thick outline, not a tiny gap.',
  ],
  'simple-vehicle-coloring-pages/fire-truck.md': [
    'A fire truck with a ladder and a hose. The body is one big color. For about ages 4 to 5.',
    'Color the truck body first. The ladder and the wheels are there if there is still time.',
  ],
  'halloween-coloring-pages/little-cauldron.md': [
    'A cauldron with three bubbles. The pot is one big color. For about ages 4 to 5.',
    'The pot is one big color. Each bubble can be different if they want three small jobs.',
  ],
  'woodland-animal-coloring-pages/woodland-hedgehog.md': [
    'A hedgehog with thick spines, each one a closed shape. For a longer sitting, about ages 6 to 8.',
    'There are a lot of spines, but each one is still a closed shape. Two colors taking turns through them is enough.',
  ],
  'first-animal-coloring-pages/round-turtle.md': [
    'One huge shell and a few legs. The shell is the page. For about ages 2 to 3.',
    'The shell is the page. The head and the legs are there if they want another color, not a second project.',
  ],
  'dinosaur-scene-coloring-pages/plated-stegosaurus.md': [
    'A stegosaurus with plates you can color one by one. For about ages 5 to 6.',
    'Alternate two colors down the plates, then color the body.',
  ],
  'halloween-coloring-pages/candy-apple.md': [
    'A candy apple with a stick and a bow. The apple is the big area. For about ages 4 to 5.',
    'The apple is the big fill. The bow and the stick are the extras.',
  ],
  'christmas-coloring-pages/striped-mitten.md': [
    'A mitten with a cuff and a snowflake. The snowflake is a few thick pieces, not lace. For about ages 4 to 5.',
    'The mitten is the big area. The snowflake is a few thick pieces, not a lace pattern to struggle with.',
  ],
  'simple-vehicle-coloring-pages/farm-tractor.md': [
    'A tractor with a huge rear wheel. Kids usually start with that wheel. For about ages 4 to 5.',
    'The big rear wheel is where most kids start. The body and the seat are the next two colors.',
  ],
  'fall-coloring-pages/sunflower.md': [
    'A sunflower with petals and a stem. The petals can all be one color. For about ages 4 to 5.',
    'The petals can all be one yellow. The center and the leaves are the other two jobs.',
  ],
  'first-animal-coloring-pages/sitting-cat.md': [
    'A sitting cat made of a few huge shapes. No stripes. For about ages 2 to 3.',
    'The body is one big area. The ears and the tail are small enough to skip if they are done.',
  ],
  'woodland-animal-coloring-pages/woodland-deer.md': [
    'A deer with spots, and a few trees behind it. For about ages 6 to 8.',
    'Give the spots one color, then a second color for the coat around them. The trees can wait.',
  ],
  'dinosaur-scene-coloring-pages/frilled-triceratops.md': [
    'A triceratops with a frill split into sections. Each section can be its own color. For about ages 5 to 6.',
    'Each section of the frill can be its own color. The horns are a small job after the frill.',
  ],
  'christmas-coloring-pages/huge-present.md': [
    'One box and a ribbon. Big enough to scribble. For about ages 2 to 3.',
    'The box is the main shape. The ribbon is a second color if they want one.',
  ],
  'simple-vehicle-coloring-pages/little-boat.md': [
    'A hull, a cabin, and a sail. Two big jobs, not a whole harbor. For about ages 4 to 5.',
    'The hull and the sail are the two big jobs. The cabin window is a small extra, not a whole scene.',
  ],
  'halloween-coloring-pages/huge-bat.md': [
    'One bat, a few huge shapes, and a smile that is just a curve. For about ages 2 to 3.',
    'The wings and the body can be the same color. The smile is a curve, not a row of teeth.',
  ],
  'fall-coloring-pages/huge-acorn.md': [
    'One huge acorn: a cap and a nut. Two colors. For about ages 2 to 3.',
    'The nut and the cap are the two colors. That is the whole page.',
  ],
  'first-animal-coloring-pages/simple-butterfly.md': [
    'Four huge wings and a body. Matching wings can be the same color. For about ages 2 to 3.',
    'Each wing is one big area. Matching wings can share a color, or all four can be one color.',
  ],
  'woodland-animal-coloring-pages/woodland-owl.md': [
    'An owl with feather shapes to color, and a moon. For about ages 6 to 8.',
    'Do one wing before the other so the pattern stays even. The moon is one large shape at the end.',
  ],
  'dinosaur-scene-coloring-pages/long-neck.md': [
    'A long-neck dinosaur with patches along the neck. For about ages 5 to 6.',
    'The neck patches repeat. The legs and the leaves can wait until the neck is done.',
  ],
  'halloween-coloring-pages/huge-ghost.md': [
    'One simple ghost. The eyes can stay uncolored. No dark scene behind it. For about ages 2 to 3.',
    'The ghost is one shape. The eyes can stay the color of the paper. There is no dark scene behind it.',
  ],
  'simple-vehicle-coloring-pages/train-engine.md': [
    'One train engine and big wheels. No number on the engine. For about ages 4 to 5.',
    'Color the engine body first. The same color can go on all three wheels.',
  ],
  'christmas-coloring-pages/huge-ornament.md': [
    'One big ornament and a stripe. For a child about 2 or 3.',
    'The ornament is one big circle. The stripe can be a second color, or the same color.',
  ],
  'fall-coloring-pages/huge-apple.md': [
    'One huge apple. Cover the apple. The leaf is the only extra. For about ages 2 to 3.',
    'Cover the apple first. The leaf is the only extra piece.',
  ],
  'woodland-animal-coloring-pages/woodland-fox.md': [
    'A fox with stripes on the tail, and a simple bit of forest. For about ages 6 to 8.',
    'Start with the tail stripes. The trees and mushrooms are background, and they can use the leftover colors.',
  ],
  'dinosaur-scene-coloring-pages/spotted-trex.md': [
    'A T-rex with large spots. Two colors taking turns on the spots is enough of a plan. For about ages 5 to 6.',
    'The spots are the pattern. Alternate two colors, then color the body around them.',
  ],
  'christmas-coloring-pages/huge-tree.md': [
    'Three big tree sections and three ornaments. Each triangle can be the same green. For about ages 2 to 3.',
    'Each triangle can be the same green. The three ornaments are the only extra shapes.',
  ],
  'halloween-coloring-pages/huge-pumpkin.md': [
    'One huge pumpkin. The leaf and the stem are optional. For about ages 2 to 3.',
    'The pumpkin is one big area. The leaf and the stem are optional second colors.',
  ],
  'simple-vehicle-coloring-pages/family-car.md': [
    'A family car with doors and windows. The body is the big area. For about ages 4 to 5.',
    'Color the body first. Each window and each wheel can be its own color after that.',
  ],
  'fall-coloring-pages/huge-leaf.md': [
    'One huge leaf and a stem. For a child about 2 or 3 who still scribbles.',
    'The leaf is one big area. The stem can be a second color, or the same color if they are finished.',
  ],
  'first-animal-coloring-pages/round-puppy.md': [
    'A puppy made of a few huge shapes. Body, head, ears, and a tail. For about ages 2 to 3.',
    'The body and the head are the main job. The ears and the tail are the only extra pieces, so the page stays short.',
  ],
  'garden-coloring-pages/birdhouse.md': [
    'A birdhouse with a bird on the roof. House and post first. For about ages 4 to 5.',
    'Color the house and the post first. The bird and the leaves are the extra pieces if they are still interested.',
  ],
  'town-scene-coloring-pages/bakery-window.md': [
    'Cakes, bread, and a striped awning. No shop name. For a longer sitting, about ages 6 to 8.',
    'Treat each cake as its own small picture. The awning stripes and the bricks repeat around them. There is no shop name to color around.',
  ],
  'ocean-scene-coloring-pages/sea-turtle.md': [
    'A sea turtle with a shell split into pieces, and two fish. The shell is the long part. For about ages 5 to 6.',
    'The shell segments take the time. The body and the two fish are quicker, so they work as a finish line.',
  ],
  'garden-coloring-pages/garden-gate.md': [
    'A garden gate with vines and two pots. For about ages 4 to 5.',
    'The gate is the big shape. The pots and the vine leaves come after the posts.',
  ],
  'town-scene-coloring-pages/greenhouse.md': [
    'A greenhouse with rows of pots and glass panes. One row is a fine stopping point. For about ages 6 to 8.',
    'Each pot is the same job repeated. They can color one row, stop, and the page still looks intentional.',
  ],
  'ocean-scene-coloring-pages/lighthouse-coast.md': [
    'A lighthouse, rocks, waves, and a small boat. No name on the tower. For about ages 5 to 6.',
    'The tower can be stripes of two colors. The rocks and the boat are separate jobs after the stripes.',
  ],
  'big-shape-coloring-pages/big-star.md': [
    'One huge star. Nothing inside it to finish. For about ages 2 to 3.',
    'There is nothing inside the star to finish. One color across the whole shape is a complete page.',
  ],
  'garden-coloring-pages/rain-boots.md': [
    'Two rain boots, a puddle, and one flower. For about ages 4 to 5.',
    'The two boots are the main shapes. The puddle and the flower give a second and third color without a whole scene.',
  ],
  'town-scene-coloring-pages/passenger-train.md': [
    'A passenger train with windows and a side stripe. No number on the train. For about ages 6 to 8.',
    'The windows can all be one color so the train looks finished early. The stripe and the flowers are the pattern work after that.',
  ],
  'big-shape-coloring-pages/drinking-cup.md': [
    'One big cup and a handle. For about ages 2 to 3.',
    'Color the cup first. The handle is a separate loop if they want a second color.',
  ],
  'ocean-scene-coloring-pages/patterned-octopus.md': [
    'An octopus with spots on every arm. Every other spot the same color is enough of a plan. For about ages 5 to 6.',
    'The spots are the pattern. Coloring every other spot the same color is enough. The face can stay a single color.',
  ],
  'garden-coloring-pages/vegetable-basket.md': [
    'A basket with three vegetables. The bands of the basket are wide, not a fiddly weave. For about ages 4 to 5.',
    'Each vegetable can be its own color. The basket bands are wide on purpose so they are not a fiddly weave.',
  ],
  'big-shape-coloring-pages/simple-fish.md': [
    'A fish made of a few huge shapes. Body, tail, and a fin. For about ages 2 to 3.',
    'The body is the main job. The tail and the fin are the only extra pieces, so the page stays short.',
  ],
  'town-scene-coloring-pages/treehouse.md': [
    'A treehouse with windows, a ladder, and leaves. For about ages 6 to 8.',
    'Color the windows as a set, then the leaves. Two colors taking turns on the ladder rungs is a clear plan.',
  ],
  'ocean-scene-coloring-pages/sailboat.md': [
    'A sailboat with waves, sails, and sky. A good first ocean page. For about ages 5 to 6.',
    'The sails and the hull are the big areas. The waves are stripes, so two blues taking turns is enough.',
  ],
  'big-shape-coloring-pages/whole-apple.md': [
    'One huge apple. The leaf is optional. For about ages 2 to 3.',
    'The apple is one big area. The leaf can be a second color, or the same color if they do not want another job.',
  ],
  'ocean-scene-coloring-pages/coral-reef.md': [
    'A coral reef with fish and seaweed. Finish one fish before the coral. For about ages 5 to 6.',
    'Pick one fish and finish it before starting the coral. The branches repeat, so the same two colors can rotate through them.',
  ],
  'town-scene-coloring-pages/hot-air-balloon.md': [
    'A hot air balloon with patterned panels. The clearest pattern in the town pile. For about ages 6 to 8.',
    'The panels are the pattern. Give stripes one pair of colors and dots another. The hills and the house can wait until the balloon is done.',
  ],
  'garden-coloring-pages/watering-can.md': [
    'A watering can with two flowers beside it. For about ages 4 to 5.',
    'The can, the spout, and each flower are separate colors. The leaves are the smaller job after the big shapes.',
  ],
  'big-shape-coloring-pages/big-ball.md': [
    'One huge ball and one stripe. Any color that covers it counts, even past the line. For about ages 2 to 3.',
    'This is one ball and one stripe. Any color that covers the shape counts, even if it goes past the line.',
  ],
};

function yaml(value) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

const files = walk(root);
const rels = files.map((file) => path.relative(root, file).replace(/\\/g, '/'));
const missing = rels.filter((rel) => !copy[rel]);
const extra = Object.keys(copy).filter((rel) => !rels.includes(rel));
if (missing.length || extra.length) {
  console.error('missing', missing);
  console.error('extra', extra);
  process.exit(1);
}

for (const file of files) {
  const rel = path.relative(root, file).replace(/\\/g, '/');
  const [description, parentNote] = copy[rel];
  let text = fs.readFileSync(file, 'utf8');
  if (!/^description:/m.test(text)) throw new Error(`no description ${rel}`);
  text = text.replace(/^description:.*$/m, `description: ${yaml(description)}`);
  if (parentNote) {
    if (!/^parentNote:/m.test(text)) throw new Error(`no parentNote ${rel}`);
    text = text.replace(/^parentNote:.*$/m, `parentNote: ${yaml(parentNote)}`);
  }
  fs.writeFileSync(file, text);
}

console.log(`updated ${files.length} sheets`);
