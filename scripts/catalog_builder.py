#!/usr/bin/env python3
"""
Catalog Builder & Asset Generator for Chatty Virtual Gifts Marketplace.
Generates:
1. 600 unique gifts across 25 categories (at least 20 per category).
2. Unique transparent vector SVG visual assets for every gift.
3. Organized asset directory structure matching user specification.
4. JSON & JS catalog data files.
5. Strict validation check of assets, slugs, IDs, prices, and categories.
"""

import os
import json
import re
import shutil

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
SERVER_PUBLIC_ASSETS = os.path.join(ROOT_DIR, "server/public/assets/gifts")
CLIENT_PUBLIC_ASSETS = os.path.join(ROOT_DIR, "client/public/assets/gifts")
SERVER_DATA_DIR = os.path.join(ROOT_DIR, "server/src/modules/gifts/data")
CLIENT_GIFT_DIR = os.path.join(ROOT_DIR, "client/src/components/Chat/gift")

# The 25 Categories and their exact target counts
CATEGORIES = [
    {"id": "love", "name": "Love & Romance", "folder": "love", "target": 30, "icon": "❤️", "gradient": ["#f43f5e", "#be123c"], "accent": "#fda4af"},
    {"id": "flowers", "name": "Flowers & Nature", "folder": "flowers", "target": 25, "icon": "🌸", "gradient": ["#10b981", "#047857"], "accent": "#6ee7b7"},
    {"id": "animals", "name": "Cute Animals", "folder": "animals", "target": 30, "icon": "🐼", "gradient": ["#f59e0b", "#b45309"], "accent": "#fde68a"},
    {"id": "pets", "name": "Pets & Companions", "folder": "pets", "target": 20, "icon": "🐶", "gradient": ["#d97706", "#92400e"], "accent": "#fcd34d"},
    {"id": "birthday", "name": "Birthday & Celebration", "folder": "birthday", "target": 25, "icon": "🎂", "gradient": ["#8b5cf6", "#6d28d9"], "accent": "#c4b5fd"},
    {"id": "luxury", "name": "Premium & Luxury", "folder": "luxury", "target": 30, "icon": "👑", "gradient": ["#eab308", "#a16207"], "accent": "#fef08a"},
    {"id": "fantasy", "name": "Royal & Fantasy", "folder": "fantasy", "target": 20, "icon": "🏰", "gradient": ["#7c3aed", "#4c1d95"], "accent": "#ddd6fe"},
    {"id": "food", "name": "Food & Desserts", "folder": "food", "target": 25, "icon": "🧁", "gradient": ["#f97316", "#c2410c"], "accent": "#fed7aa"},
    {"id": "drinks", "name": "Drinks & Beverages", "folder": "drinks", "target": 20, "icon": "🍹", "gradient": ["#06b6d4", "#0e7490"], "accent": "#a5f3fc"},
    {"id": "gaming", "name": "Gaming & Technology", "folder": "gaming", "target": 25, "icon": "🎮", "gradient": ["#a855f7", "#7e22ce"], "accent": "#f0abfc"},
    {"id": "entertainment", "name": "Music & Entertainment", "folder": "entertainment", "target": 25, "icon": "🎸", "gradient": ["#ec4899", "#be185d"], "accent": "#fbcfe8"},
    {"id": "friendship", "name": "Friendship & Appreciation", "folder": "friendship", "target": 20, "icon": "🤝", "gradient": ["#3b82f6", "#1d4ed8"], "accent": "#bfdbfe"},
    {"id": "festivals", "name": "Festivals & Culture", "folder": "festivals", "target": 30, "icon": "🪔", "gradient": ["#ea580c", "#d97706"], "accent": "#fed7aa"},
    {"id": "travel", "name": "Travel & Adventure", "folder": "travel", "target": 25, "icon": "✈️", "gradient": ["#0284c7", "#0f766e"], "accent": "#bae6fd"},
    {"id": "sports", "name": "Sports & Fitness", "folder": "sports", "target": 25, "icon": "⚽", "gradient": ["#16a34a", "#15803d"], "accent": "#bbf7d0"},
    {"id": "fashion", "name": "Fashion & Beauty", "folder": "fashion", "target": 25, "icon": "💄", "gradient": ["#db2777", "#9d174d"], "accent": "#fbcfe8"},
    {"id": "cars", "name": "Cars & Supercars", "folder": "cars", "target": 20, "icon": "🏎️", "gradient": ["#dc2626", "#991b1b"], "accent": "#fca5a5"},
    {"id": "space", "name": "Space & Galaxy", "folder": "space", "target": 25, "icon": "🚀", "gradient": ["#4338ca", "#312e81"], "accent": "#c7d2fe"},
    {"id": "magic", "name": "Magic & Fantasy", "folder": "magic", "target": 20, "icon": "🪄", "gradient": ["#9333ea", "#581c87"], "accent": "#e9d5ff"},
    {"id": "animated", "name": "Animated & Special Effects", "folder": "animated", "target": 30, "icon": "✨", "gradient": ["#f43f5e", "#7c3aed"], "accent": "#fef08a"},
    {"id": "emotional", "name": "Emotional & Support", "folder": "emotional", "target": 20, "icon": "🤗", "gradient": ["#38bdf8", "#0284c7"], "accent": "#e0f2fe"},
    {"id": "achievements", "name": "Achievement & Awards", "folder": "achievements", "target": 20, "icon": "🏆", "gradient": ["#f59e0b", "#d97706"], "accent": "#fef08a"},
    {"id": "baby-kids", "name": "Baby & Kids", "folder": "baby-kids", "target": 20, "icon": "🧸", "gradient": ["#fb7185", "#c084fc"], "accent": "#fce7f3"},
    {"id": "seasonal", "name": "Seasonal & Weather", "folder": "seasonal", "target": 20, "icon": "🍂", "gradient": ["#ea580c", "#9a3412"], "accent": "#fed7aa"},
    {"id": "limited-edition", "name": "Exclusive Limited Edition", "folder": "limited-edition", "target": 25, "icon": "💎", "gradient": ["#c026d3", "#0891b2"], "accent": "#a5f3fc"},
]

# Raw data definitions: 600 unique gifts
ITEMS_DATA = {
    "love": [
        ("Red Rose", "A classic single red rose expressing pure, timeless romance.", "🌹", 15, "common", False),
        ("Pink Rose", "A tender pink rose symbolizing gentleness, sweetness, and admiration.", "🌸", 15, "common", False),
        ("Rose Bouquet", "A luxuriant bundle of fresh red and pink roses wrapped in satin ribbon.", "💐", 50, "rare", False),
        ("Diamond Heart", "A sparkling brilliant-cut diamond carved into a glowing radiant heart.", "💎", 500, "epic", True),
        ("Forever Love", "An infinity symbol interwoven with two golden hearts sealed for eternity.", "♾️", 350, "epic", True),
        ("Love Letter", "A vintage wax-sealed envelope filled with poetic handwritten devotion.", "💌", 20, "common", False),
        ("Teddy Love", "An adorable plush teddy bear hugging a crimson satin heart pillow.", "🧸", 80, "rare", False),
        ("Couple Ring", "Matching platinum promise rings embedded with starlight crystals.", "💍", 400, "epic", True),
        ("Heart Balloon", "A floating metallic red heart balloon tied with a golden string.", "🎈", 25, "common", False),
        ("Romantic Candle", "A softly flickering vanilla-rose scented candle creating intimate warmth.", "🕯️", 30, "common", False),
        ("Love Cake", "A decadent heart-shaped strawberry velvet cake with glazed sugar pearls.", "🎂", 75, "rare", False),
        ("Heart Necklace", "A polished 18k rose gold locket necklace designed to hold your dearest memory.", "📿", 250, "rare", False),
        ("Love Box", "A premium velvet gift box tied with shimmering silk containing sweet surprises.", "🎁", 60, "rare", False),
        ("Cupid Arrow", "A golden celestial arrow dipped in irresistible love charm.", "💘", 120, "rare", True),
        ("Wedding Ring", "An exquisite platinum band set with certified flawless diamonds.", "💍", 800, "legendary", True),
        ("Pink Heart", "A glowing soft pink heart radiating warmth and gentle affection.", "🩷", 10, "common", False),
        ("Golden Heart", "A solid polished gold heart beating with pure royal devotion.", "💛", 200, "rare", True),
        ("Love Crown", "A regally designed crown featuring ruby hearts and diamond filigree.", "👑", 600, "legendary", True),
        ("Romantic Gift Box", "A handcrafted mystery box filled with romantic keepsakes and love tokens.", "💝", 70, "rare", False),
        ("Heart Explosion", "A vibrant celebratory blast of floating hearts showering the screen.", "💥", 450, "epic", True),
        ("Kiss Envelope", "A delicate greeting card stamped with a ruby lipstick kiss.", "💋", 25, "common", False),
        ("Eternal Flame", "A magical torch of affection that burns with unending passion.", "🔥", 300, "rare", True),
        ("Lovers Key", "An antique golden key intricately crafted to unlock someone's heart.", "🗝️", 150, "rare", False),
        ("Sweet Serenade", "Floating musical notes swirling around a romantic acoustic guitar.", "🎶", 180, "rare", True),
        ("Romantic Swan", "A graceful white swan gliding across a moonlit lake forming heart reflections.", "🦢", 280, "rare", False),
        ("Crystal Rose", "A breathtaking hand-carved Swarovski crystal rose reflecting prism colors.", "🌹", 700, "legendary", True),
        ("Velvet Chocolates", "Artisan Belgian truffles packaged in a luxurious heart-shaped red velvet box.", "🍫", 65, "rare", False),
        ("Ruby Heart", "A deep pigeon-blood Burmese ruby cut into an unmatched heart gem.", "💎", 900, "legendary", True),
        ("Love Potion", "A swirling pink elixir in a corked flask bubbling with heart-shaped vapor.", "🧪", 320, "epic", True),
        ("Moonlight Promise", "A crescent moon cradling two glowing lovers beneath an ocean of stars.", "🌙", 550, "legendary", True),
    ],
    "flowers": [
        ("Sunflower", "A bright yellow blooming sunflower radiating cheerful sunny energy.", "🌻", 20, "common", False),
        ("Tulip Bundle", "A fresh assortment of Dutch spring tulips tied with silk ribbon.", "🌷", 35, "common", False),
        ("Royal Lotus", "A sacred pink water lily blooming in calm crystal waters.", "🪷", 180, "rare", True),
        ("Purple Orchid", "An exotic tropical purple orchid branch exuding elegance and mystery.", "🌺", 90, "rare", False),
        ("Cherry Blossom", "Gentle pink Sakura blossoms gracefully floating on a spring breeze.", "🌸", 120, "rare", True),
        ("Lavender Bouquet", "A calming bunch of aromatic French lavender wrapped in twine.", "🪻", 45, "common", False),
        ("Jasmine Flower", "Delicate white jasmine blossoms celebrated for their sweet, pure fragrance.", "🌼", 25, "common", False),
        ("White Lily", "A pristine white calla lily representing peace, renewal, and devotion.", "💮", 55, "common", False),
        ("Spring Daisy", "A sunny wild meadow daisy spreading childlike joy and optimism.", "🌼", 15, "common", False),
        ("Blue Rose", "A rare and mystical deep indigo rose symbolizing the unattainable dream.", "💙", 220, "epic", True),
        ("Golden Rose Nature", "An enchanted botanical rose with real gilded gold petals.", "✨", 450, "epic", True),
        ("Flower Basket", "A rustic wicker basket overflowing with seasonal countryside wildflowers.", "🧺", 110, "rare", False),
        ("Butterfly Garden", "Iridescent blue butterflies fluttering around blooming garden shrubs.", "🦋", 350, "epic", True),
        ("Rainbow Blooms", "Vibrant multicolored petals reflecting every hue of the rainbow.", "🌈", 260, "rare", True),
        ("Crystal Waterfall", "A cascading natural mountain waterfall tumbling into clear emerald pools.", "🌊", 500, "legendary", True),
        ("Nature Crown", "A forest deity diadem woven from ivy leaves, emerald moss, and morning dew.", "🌿", 380, "epic", True),
        ("Cactus Flower", "A resilient desert succulent bearing a vibrant fuchsia blossom.", "🌵", 30, "common", False),
        ("Autumn Maple", "A scarlet Japanese maple leaf glowing with warm cozy autumn spirit.", "🍁", 40, "common", False),
        ("Four Leaf Clover", "An ultra-rare four-leaf clover bestowing good fortune and prosperity.", "🍀", 150, "rare", True),
        ("Enchanted Bonsai", "A centuries-old miniature juniper bonsai growing with mystical green vitality.", "🪴", 420, "epic", True),
        ("Hibiscus Flower", "A vibrant red tropical hibiscus reminiscent of warm island breezes.", "🌺", 35, "common", False),
        ("Morning Glory", "Sky-blue morning glories greeting the dawn with fresh morning energy.", "💠", 25, "common", False),
        ("Wild Poppy", "A velvety crimson field poppy dancing gracefully in the summer wind.", "🏵️", 30, "common", False),
        ("Emerald Fern", "Lush ancient woodland ferns unfurling with primordial earthy power.", "🌿", 45, "common", False),
        ("Cosmic Sunflower", "A celestial blossom seeded with cosmic stardust and glowing solar flares.", "🌌", 600, "legendary", True),
    ],
    "animals": [
        ("Cute Puppy", "A sweet floppy-eared pup with big shiny eyes and a wagging tail.", "🐶", 50, "common", False),
        ("Playful Kitten", "A fluffy little kitten playing with a warm ball of colorful yarn.", "🐱", 50, "common", False),
        ("Giant Panda", "A cuddly baby panda happily munching on fresh bamboo leaves.", "🐼", 120, "rare", False),
        ("Fluffy Bunny", "A soft white bunny with twitching pink nose and long fuzzy ears.", "🐰", 60, "common", False),
        ("Baby Penguin", "An adorable Antarctic chick waddling across the frosty snow.", "🐧", 85, "rare", False),
        ("Baby Bear", "A chubby brown bear cub clutching a small honey pot.", "🐻", 95, "rare", False),
        ("Baby Elephant", "A joyful baby elephant splashing sparkling water from its tiny trunk.", "🐘", 140, "rare", False),
        ("Clever Fox", "A bright orange woodland fox with a bushy white-tipped tail.", "🦊", 110, "rare", False),
        ("Sleepy Koala", "A cozy gray koala clinging peacefully to a fragrant eucalyptus branch.", "🐨", 130, "rare", False),
        ("Gentle Deer", "A graceful spotted forest fawn stepping cautiously through sunlit meadows.", "🦌", 160, "rare", False),
        ("Lion Cub", "A playful golden cub of the savanna practicing its first mighty roar.", "🦁", 200, "rare", True),
        ("Baby Tiger", "A striped Bengal tiger kitten full of mischievous, bouncy curiosity.", "🐯", 220, "rare", True),
        ("Tiny Hamster", "A round golden hamster stuffing sunflower seeds into chubby cheeks.", "🐹", 30, "common", False),
        ("Colorful Parrot", "A radiant macaw parrot with brilliant scarlet, blue, and yellow plumage.", "🦜", 90, "rare", False),
        ("Golden Retriever", "Man's most loyal companion beaming with unconditional warmth and joy.", "🐕", 150, "rare", False),
        ("Royal Corgi", "An energetic Welsh corgi wearing a tiny velvet crown and red cape.", "🐕‍🦺", 175, "rare", True),
        ("Shiba Inu", "The iconic Japanese Shiba Inu with curly tail and famous cheerful grin.", "🐕", 160, "rare", False),
        ("Dancing Duck", "A comical yellow duckling grooving to a happy beat in cute rain boots.", "🦆", 75, "common", True),
        ("Sea Otter", "A cute river otter floating comfortably on its back holding a prized clam.", "🦦", 180, "rare", True),
        ("Baby Seal", "A fluffy white harp seal pup resting peacefully on arctic sea ice.", "🦭", 140, "rare", False),
        ("Hedgehog", "A miniature rolled-up hedgehog showing its curious little snout.", "🦔", 65, "common", False),
        ("Raccoon Buddy", "A clever masked bandit with nimble paws and infinite curiosity.", "🦝", 85, "common", False),
        ("Squirrel Nut", "A bushy-tailed woodland squirrel treasuring a gigantic golden acorn.", "🐿️", 40, "common", False),
        ("Cute Owl", "A wise little barn owl with gigantic luminous golden eyes.", "🦉", 110, "rare", False),
        ("Red Panda", "A rust-colored Himalayan red panda balancing adorably across branches.", "🐾", 210, "rare", True),
        ("Dolphin Leap", "A joyful bottle-nosed dolphin jumping through sun-drenched ocean crests.", "🐬", 250, "epic", True),
        ("Baby Sloth", "The world's coziest creature taking life slow with a sweet sleepy smile.", "🦥", 125, "rare", False),
        ("Playful Monkey", "A cheeky brown capuchin swinging from vines holding a yellow banana.", "🐒", 95, "common", False),
        ("Baby Giraffe", "A long-legged savannah calf with gentle eyes and soft spotted coat.", "🦒", 165, "rare", False),
        ("Mini Piglet", "A tiny pink tea-cup piglet snuffling cheerfully in fresh green clover.", "🐖", 70, "common", False),
    ],
    "pets": [
        ("Pug Friend", "A wrinkly-faced pug companion with a hilarious curly tail and loving soul.", "🐶", 60, "common", False),
        ("Persian Cat", "A regal long-haired white Persian feline resting upon a silk cushion.", "🐱", 130, "rare", False),
        ("Golden Fish", "A shimmering goldfish swimming in clean crystal waters granting tiny wishes.", "🐟", 40, "common", True),
        ("Canary Bird", "A bright yellow songbird piping cheerful melodies from its perch.", "🐤", 55, "common", False),
        ("Loyal Husky", "A stunning Siberian husky with striking icy-blue eyes and wolf-like grace.", "🐺", 190, "rare", True),
        ("Fluffy Chinchilla", "The softest rodent in the world enjoying a dust bath with pure joy.", "🐭", 85, "rare", False),
        ("Cute Ferret", "A slender inquisitive ferret exploring every hidden nook and cranny.", "🦡", 75, "common", False),
        ("Spotted Dalmatian", "A distinguished white hound decorated with handsome jet-black spots.", "🐕", 140, "rare", False),
        ("Siamese Cat", "A sleek oriental feline with sapphire eyes and dark chocolate points.", "🐈", 120, "rare", False),
        ("Turtle Companion", "A wise little terrapin paddling steadily through life with serene calm.", "🐢", 45, "common", False),
        ("Chameleon Pet", "A colorful lizard changing vibrant hues between emerald, gold, and turquoise.", "🦎", 110, "rare", True),
        ("Cockatiel Pet", "A crested gray parrot with blushing orange cheeks whistling tunes.", "🦜", 70, "common", False),
        ("French Bulldog", "A sturdy bat-eared Frenchie famous for comical snorts and deep loyalty.", "🐶", 160, "rare", False),
        ("Angora Rabbit", "An ultra-fluffy ball of cloud-like angora wool with a tiny pink nose.", "🐇", 95, "rare", False),
        ("Guinea Pig", "A cheerful calico cavy squeaking excitedly for fresh crunchy bell peppers.", "🐹", 35, "common", False),
        ("Sweet Dachshund", "A long little wiener dog with short paws and immense courage.", "🐕", 115, "rare", False),
        ("Tabby Kitten", "A classic striped domestic shorthair purring contently in the sun.", "🐈", 50, "common", False),
        ("Beagle Pup", "A tri-color scent hound pup on the trail of fun adventures and treats.", "🐶", 105, "rare", False),
        ("Calico Cat", "A lucky three-colored feline believed to bring good fortune and prosperity.", "🐱", 90, "rare", False),
        ("Toy Poodle", "A perfectly groomed apricot toy poodle with bounce, grace, and brains.", "🐩", 150, "rare", True),
    ],
    "birthday": [
        ("Birthday Cake", "A delicious vanilla sponge cake topped with colorful sprinkles and a candle.", "🎂", 40, "common", False),
        ("Three Tier Cake", "A magnificent multi-tiered celebration cake topped with sugar fireworks.", "🎂", 250, "epic", True),
        ("Party Popper", "A snap of festive noise showering everyone in multicolored confetti.", "🎉", 15, "common", False),
        ("Confetti Explosion", "A vibrant celebratory blast filling the entire room with dazzling confetti.", "🎊", 80, "rare", True),
        ("Fireworks Display", "A grand nighttime pyrotechnic show illuminating the sky with golden sparkles.", "🎆", 300, "epic", True),
        ("Celebration Balloon", "A shiny chrome celebration balloon floating high with golden ribbons.", "🎈", 25, "common", False),
        ("Surprise Gift Box", "A mysterious colorful gift package wrapped with a grand glossy bow.", "🎁", 60, "common", False),
        ("Colorful Party Hat", "A festive polka-dot cone hat crowned with a fluffy pom-pom.", "🥳", 20, "common", False),
        ("Birthday Crown", "A glittering golden party crown declaring you the sovereign of your special day.", "👑", 120, "rare", False),
        ("Birthday Surprise", "A box that bursts open to release music, confetti, and floating stars.", "✨", 180, "rare", True),
        ("Celebration Star", "A radiant gold star plaque recognizing your milestone achievement.", "⭐", 75, "common", False),
        ("Cupcake Tower", "A stand loaded with gourmet frosted cupcakes in every beloved flavor.", "🧁", 95, "rare", False),
        ("Champagne Toast", "Popping bubbly vintage champagne to honor your extraordinary moments.", "🍾", 200, "rare", True),
        ("Sparkler Wand", "A hand-held metal sparkler fizzing with brilliant white and gold stars.", "🪄", 35, "common", True),
        ("Golden Confetti", "Cascades of metallic gold foil fluttering gracefully through the air.", "✨", 90, "rare", True),
        ("Birthday Candle", "A magic spiral candle waiting for your most heartfelt secret wish.", "🕯️", 10, "common", False),
        ("Celebration Bell", "A silver hand bell chiming joyous news across the party hall.", "🔔", 45, "common", False),
        ("Carnival Mask", "A Venetian festival masquerade mask decorated with feathers and glitter.", "🎭", 110, "rare", False),
        ("Pinata Burst", "A traditional donkey pinata breaking open to rain candies and sweets.", "🪅", 130, "rare", True),
        ("Festive Banner", "A cheerful garland banner proclaiming joy across the celebration space.", "🎏", 30, "common", False),
        ("Music Box", "A winding vintage box that plays harmonious birthday melodies.", "📻", 160, "rare", True),
        ("Neon Party Lights", "Pulsing disco neon strobes bringing festival energy to your screen.", "💡", 140, "rare", True),
        ("Golden Whistle", "A loud ceremonial party whistle that gets the whole crowd cheering.", "🪈", 50, "common", False),
        ("Celebration Ribbon", "A satin rosette ribbon acknowledging your star presence today.", "🎗️", 25, "common", False),
        ("Jubilee Trophy", "A magnificent ceremonial chalice marking a once-in-a-lifetime milestone.", "🏆", 400, "epic", True),
    ],
    "luxury": [
        ("Diamond Solitaire Ring", "A massive certified D-color flawless solitaire set in platinum prongs.", "💍", 1200, "legendary", True),
        ("Golden Emperor Crown", "An imperial masterpiece of solid 24K gold encrusted with rubies and sapphires.", "👑", 1800, "legendary", True),
        ("Luxury Sports Car", "A sleek Italian exotic masterpiece in iconic Rosso Corsa.", "🏎️", 2500, "mythic", True),
        ("Gold Supercar", "A customized hypercar wrapped in mirror-finish polished 24K gold foil.", "🚘", 3000, "mythic", True),
        ("Private Jet", "A twin-engine ultra-long-range luxury jet cruising above the clouds.", "🛩️", 4500, "mythic", True),
        ("Luxury Yacht", "A 300-foot megayacht complete with helipad, infinity pool, and crystal lounge.", "🛥️", 5000, "mythic", True),
        ("Solid Gold Trophy", "A heavyweight solid gold cup awarded only to supreme conquerors.", "🏆", 1500, "legendary", True),
        ("24K Golden Rose", "A real preserved long-stem rose electroplated in pure 24-karat gold.", "🌹", 850, "legendary", True),
        ("Royal Palace", "A palatial neoclassical estate with marble columns, fountains, and ballrooms.", "🏰", 6000, "mythic", True),
        ("Diamond Tennis Necklace", "A continuous strand of 50 brilliant round diamonds cascading in light.", "📿", 1600, "legendary", True),
        ("Luxury Swiss Watch", "A handcrafted mechanical tourbillon timepiece forged from titanium and rose gold.", "⌚", 2000, "legendary", True),
        ("Crystal Heart Sculpture", "A museum-grade optical crystal sculpture refracting vibrant spectra.", "💎", 950, "legendary", False),
        ("Golden Dragon Statue", "An intricately cast gold dragon clutching a blazing imperial pearl.", "🐉", 2200, "legendary", True),
        ("Platinum Regal Crown", "A platinum diadem adorned with rare Kashmir sapphires and pearls.", "👑", 2400, "mythic", True),
        ("Sapphire Pendant", "A midnight-blue Ceylon sapphire encircled by a halo of micro-pave diamonds.", "🔷", 1100, "legendary", True),
        ("Emerald Cufflinks", "Deep green Colombian emeralds cut into octagons set in 18k yellow gold.", "🟢", 750, "epic", False),
        ("Ruby Tiara", "A historical royal tiara ablaze with fire-engine red Burmese rubies.", "👑", 1700, "legendary", True),
        ("Billionaire Briefcase", "An aerospace-grade carbon fiber attaché packed with gold bearer bonds.", "💼", 1300, "legendary", False),
        ("Champagne Crystal Flutes", "Handblown Baccarat crystal stemware filled with Dom Pérignon vintage.", "🥂", 650, "epic", False),
        ("Golden Ingot Stack", "A pyramid of serialized 99.99% pure bullion bricks from the central vault.", "🪙", 2800, "mythic", True),
        ("Luxury Penthouse", "A glass-walled sky mansion floating high above the metropolitan skyline.", "🏙️", 5500, "mythic", True),
        ("Pearl Choker", "Triple-strand Japanese Akoya seawater pearls with high mirror luster.", "📿", 800, "epic", False),
        ("Gold Credit Card", "A solid 14k gold card with no pre-set spending limit for VIPs only.", "💳", 900, "epic", True),
        ("Diamond Watch", "An iced-out luxury chronograph completely covered in factory baguettes.", "⌚", 2600, "mythic", True),
        ("Platinum Bar", "A minted one-kilogram platinum bar with mirror finish and proof stamps.", "🪙", 2100, "legendary", True),
        ("Luxury Limousine", "A chauffeur-driven stretch limousine with starlight headliner and bar.", "🚘", 1900, "legendary", False),
        ("Golden Lion Seal", "An antique imperial signet depicting a roaring lion in pure gold relief.", "🦁", 1400, "legendary", True),
        ("Imperial Scepter", "The symbol of supreme planetary authority topped with the Cullinan diamond.", "🪄", 3200, "mythic", True),
        ("Royal Chalice", "A gold goblet studded with emeralds used during coronation banquets.", "🍷", 1250, "legendary", False),
        ("Diamond Encrusted Skull", "An avant-garde contemporary masterpiece encrusted with 8,601 diamonds.", "💀", 7000, "mythic", True),
    ],
    "fantasy": [
        ("Royal Throne", "The gilded seat of majestic rule draped with imperial ermine and velvet.", "👑", 1500, "legendary", True),
        ("King Crown", "The official crown of state adorned with legendary coronation jewels.", "👑", 1200, "legendary", True),
        ("Queen Diadem", "A delicate diamond and sapphire tiara worn by beloved queens throughout eras.", "👑", 1100, "legendary", True),
        ("Royal Castle", "An imposing medieval fortress of stone towers, battlements, and banners.", "🏰", 2500, "mythic", True),
        ("Knights Shield", "A polished steel heater shield painted with noble family heraldry.", "🛡️", 300, "rare", False),
        ("Excalibur Sword", "The legendary blade pulled from stone, glowing with celestial righteousness.", "⚔️", 1800, "legendary", True),
        ("Royal Pegasus", "A majestic winged stallion soaring across clouds with silver feather wings.", "🦄", 2200, "mythic", True),
        ("Enchanted Mirror", "An ornate brass mirror reflecting secret truths and far-away lands.", "🪞", 450, "epic", True),
        ("Royal Carriage", "A gilded baroque coach pulled by six white horses along cobblestone avenues.", "🎠", 900, "epic", False),
        ("Crystal Ball Fortune", "A mystical orb of pure quartz misting over with visions of tomorrow.", "🔮", 380, "rare", True),
        ("Magical Griffin", "The mythical half-lion half-eagle guardian of secret gold treasures.", "🦅", 1600, "legendary", True),
        ("Fairy Godmother Wand", "A star-tipped wand that turns everyday worries into golden magic.", "🪄", 500, "epic", True),
        ("Golden Feather Quill", "A writer's sacred quill plucked from the wings of a celestial angel.", "🪶", 250, "rare", False),
        ("Ancient Spellbook", "Leather-bound grimoire containing centuries of mystical arcane incantations.", "📖", 650, "epic", True),
        ("Phoenix Crest", "A flaming gold badge honoring rebirth, eternal renewal, and resilience.", "🔥", 850, "legendary", True),
        ("Royal Seal Ring", "A heavyweight gold signet used by sovereigns to stamp proclamations.", "💍", 420, "rare", False),
        ("Dragon Egg", "A petrified scaled egg radiating gentle inner draconic warmth.", "🥚", 1400, "legendary", True),
        ("Elven Bow", "A recurve longbow carved from elderwood strung with spun starlight.", "🏹", 550, "rare", False),
        ("Royal Banner", "A silk standards embroidered with gold thread waving in castle winds.", "🚩", 180, "common", False),
        ("Wizard Tower", "A solitary stone spire piercing stormy mountain clouds, lit by arcane lamps.", "🗼", 1300, "legendary", True),
    ],
    "food": [
        ("Chocolate Luxury Box", "A curated selection of 24 handcrafted dark truffles and pralines.", "🍫", 65, "common", False),
        ("Cheesy Pizza Slice", "A piping-hot slice of New York style pizza with stringy mozzarella pull.", "🍕", 25, "common", False),
        ("Gourmet Burger", "A wagyu beef patty on brioche bun with smoked bacon and melted cheddar.", "🍔", 35, "common", False),
        ("Rainbow Cupcake", "A fluffy vanilla cupcake topped with pastel swirl frosting and glitter.", "🧁", 20, "common", False),
        ("Glazed Donut", "A warm fried donut coated in a sweet crystalline sugar glaze.", "🍩", 15, "common", False),
        ("Strawberry Shortcake", "Layers of light chiffon cake, fresh cream, and ripe sweet strawberries.", "🍰", 45, "common", False),
        ("Gelato Ice Cream", "Double-scoop artisanal Italian gelato in crispy waffle cone with wafer.", "🍨", 30, "common", False),
        ("French Macarons", "An assortment of colorful Parisian almond meringue cookies with ganache.", "🍪", 55, "common", False),
        ("Premium Sushi Platter", "Fresh salmon nigiri, tuna sashimi, and spicy California rolls.", "🍣", 90, "rare", False),
        ("Pancake Tower Syrup", "A towering stack of golden buttermilk pancakes drenched in maple syrup.", "🥞", 40, "common", False),
        ("Belgian Waffle", "Crispy deep-pocket waffle topped with berries, powdered sugar, and cream.", "🧇", 35, "common", False),
        ("Layered Rainbow Cake", "Six vibrant colored cake tiers layered with creamy vanilla buttercream.", "🎂", 75, "rare", False),
        ("Chocolate Fondue Fountain", "A cascading warm fountain of molten Swiss chocolate for dipping fruit.", "🫕", 220, "rare", True),
        ("Ramen Delight", "Steaming bowl of rich tonkotsu broth with noodles, egg, and chashu pork.", "🍜", 40, "common", False),
        ("Crunchy Tacos", "Crispy corn tortillas packed with seasoned meat, salsa, and guacamole.", "🌮", 30, "common", False),
        ("Hot Fudge Sundae", "Vanilla ice cream smothered in warm fudge sauce and a maraschino cherry.", "🍨", 35, "common", False),
        ("Sweet Boba Tea", "Creamy brown sugar milk tea loaded with chewy tapioca pearls.", "🧋", 25, "common", False),
        ("Croissant Butter", "Flaky golden French pastry baked to crispy perfection with sweet butter.", "🥐", 20, "common", False),
        ("Dim Sum Basket", "Steamed bamboo basket with translucent har gow and pork dumplings.", "🥟", 50, "common", False),
        ("Churros Chocolate", "Cinnamon sugar Spanish churros served with thick hot dipping chocolate.", "🥖", 30, "common", False),
        ("Fresh Cherry Pie", "A lattice-crusted homemade pie bubbling with tart red cherry filling.", "🥧", 45, "common", False),
        ("Popcorn Bucket", "Warm theater popcorn tossed in rich movie-butter seasoning.", "🍿", 15, "common", False),
        ("Pretzel Twist", "A golden baked Bavarian soft pretzel sprinkled with coarse sea salt.", "🥨", 20, "common", False),
        ("Candy Cane Treat", "Peppermint striped holiday candy canes spreading sweet festive cheer.", "🦯", 10, "common", False),
        ("Honeycomb Dessert", "Natural raw wildflower honeycomb dripping with sweet golden nectar.", "🍯", 60, "rare", False),
    ],
    "drinks": [
        ("Tropical Cocktail", "A vibrant rum punch served in a tiki glass with pineapple slice and umbrella.", "🍹", 45, "common", False),
        ("Morning Cappuccino", "Freshly pulled espresso with velvety steamed foam and cinnamon dusting.", "☕", 20, "common", False),
        ("Iced Matcha Latte", "Ceremonial Japanese green tea whisked with cold oat milk and ice.", "🍵", 35, "common", False),
        ("Boba Milk Tea", "Classic Taiwanese black milk tea with slow-cooked brown sugar boba pearls.", "🧋", 25, "common", False),
        ("Vintage Red Wine", "An aged Bordeaux grand cru poured into an elegant sommelier glass.", "🍷", 110, "rare", False),
        ("Sparkling Champagne", "Chilled vintage cuvée effervescing with fine bubbles in a tall flute.", "🥂", 150, "rare", True),
        ("Coconut Water Drink", "A fresh young green coconut with a bamboo straw on sunny tropical sands.", "🥥", 30, "common", False),
        ("Fresh Orange Juice", "Cold-pressed Valencia oranges brimming with immune-boosting vitamin C.", "🍊", 20, "common", False),
        ("Berry Smoothie", "A thick blended powerhouse of wild blueberries, raspberries, and yogurt.", "🥤", 30, "common", False),
        ("Bubble Lemonade", "Sparkling fizzy lemonade garnished with fresh mint sprigs and lemon wheels.", "🍋", 25, "common", False),
        ("Caramel Frappuccino", "Blended iced coffee beverage swirled with whipped cream and caramel drizzle.", "☕", 40, "common", False),
        ("Hot Cocoa Marshmallow", "Rich Dutch cocoa crowned with mini pillowy marshmallows.", "☕", 25, "common", False),
        ("Craft Beer Mug", "A frosted stein of golden artisanal IPA with a thick creamy foam head.", "🍺", 35, "common", False),
        ("Espresso Shot", "A bold concentrated double shot of dark Italian roast with rich crema.", "☕", 15, "common", False),
        ("Iced Peach Tea", "Crisp brewed black tea infused with sweet Georgia peach slices.", "🧋", 25, "common", False),
        ("Blue Lagoon Drink", "Curacao liqueur mixed with citrus lemonade glowing with electric cyan hues.", "🍸", 60, "rare", True),
        ("Mojito Fresh Mint", "Crisp white rum, crushed spearmint, lime juice, and bubbling club soda.", "🍹", 40, "common", False),
        ("Matcha Tea Set", "Traditional bamboo whisk and ceremonial stoneware bowl for Zen mindfulness.", "🍵", 85, "rare", False),
        ("Energy Boost Can", "An icy electrified energy beverage charged with caffeine and electrolytes.", "⚡", 20, "common", False),
        ("Detox Green Juice", "Cold-pressed kale, cucumber, green apple, and ginger cleansing potion.", "🥬", 30, "common", False),
    ],
    "gaming": [
        ("Pro Gaming Controller", "An ergonomic wireless gamepad with programmable back paddles and RGB.", "🎮", 80, "common", False),
        ("Next Gen Console", "A powerhouse gaming station capable of 4K 120fps ray-traced visuals.", "🕹️", 350, "epic", True),
        ("RGB Gaming Headphones", "Surround-sound headset with noise-canceling mic and pulsing LED earcups.", "🎧", 110, "rare", False),
        ("Mechanical Keyboard", "Clicky mechanical keys with custom per-key reactive RGB illumination.", "⌨️", 130, "rare", True),
        ("Esports Champion Trophy", "The premier esports championship cup lifted by legendary gamers.", "🏆", 650, "epic", True),
        ("Retro Arcade Cabinet", "A classic 80s stand-up wooden arcade machine loaded with pixel games.", "👾", 400, "epic", True),
        ("VR Meta Headset", "Next-generation virtual reality goggles with hand-tracking technology.", "🥽", 300, "rare", False),
        ("AI Companion Robot", "A smart desktop robot companion with expressive OLED eye animations.", "🤖", 220, "rare", True),
        ("Cyber Star Chip", "An overclocked neural processor chip glowing with cybernetic blue circuits.", "💾", 180, "rare", True),
        ("Ultimate Battlestation", "Triple curved monitors, liquid-cooled custom PC, and ambient lighting.", "🖥️", 900, "legendary", True),
        ("Holographic Drone", "A hovering quadcopter projecting 3D interactive holographic games.", "🛸", 280, "rare", True),
        ("GPU Graphics Card", "Flagship ray-tracing graphics card with triple-fan copper cooling.", "📟", 500, "epic", False),
        ("Retro Gameboy", "A handheld 8-bit classic gaming device in nostalgic atomic purple casing.", "🎮", 75, "common", False),
        ("Pixel Sword", "An iconic 16-bit enchanted diamond sword forged from square pixels.", "🗡️", 95, "common", False),
        ("Quantum Core", "A suspended zero-point energy sphere fueling futuristic supercomputers.", "⚛️", 750, "legendary", True),
        ("Cyber Visor", "Neon-lit cyberpunk glasses displaying live augmented-reality HUD data.", "🕶️", 140, "rare", True),
        ("Streaming Microphone", "Studio-grade broadcast cardioid condenser mic with shock mount.", "🎙️", 120, "rare", False),
        ("Gaming Chair RGB", "Ergonomic racing bucket seat with memory foam pillows and edge lighting.", "💺", 160, "rare", False),
        ("Retro Joystick", "An authentic heavy-duty ball-top arcade stick with microswitch buttons.", "🕹️", 55, "common", False),
        ("Nanotech Orb", "A swarm of sentient microscopic nanobots assembling digital realities.", "🔮", 600, "legendary", True),
        ("Cyberpunk Katana", "A high-frequency energy sword glowing with sharp cyan laser edges.", "🗡️", 450, "epic", True),
        ("Gaming Laptop Beast", "A flagship dual-screen portable gaming rig powered by liquid metal cooling.", "💻", 700, "epic", False),
        ("RGB Mousepad Horizon", "A panoramic desk mat with 360-degree dynamic addressable RGB lighting.", "🖱️", 40, "common", False),
        ("Speedrunner Trophy", "Honors the fastest frame-perfect world record speedrunner in history.", "🏆", 320, "rare", True),
        ("AI Neural Headband", "A sleek cybernetic brain-computer interface translating thoughts into gaming actions.", "🧠", 600, "legendary", True),
    ],
    "entertainment": [
        ("Electric Guitar", "A sunburst solid-body electric guitar tuned for shredding heavy rock solos.", "🎸", 180, "rare", False),
        ("Grand Piano", "A hand-polished ebony concert grand piano with 88 weighted ivory keys.", "🎹", 800, "legendary", True),
        ("Golden Microphone", "A polished 24k gold microphone fit for chart-topping vocal superstars.", "🎙️", 400, "epic", True),
        ("Vinyl Record Player", "A vintage mahogany turntable spinning warm analog grooves with needle.", "📻", 150, "rare", False),
        ("Acoustic Guitar", "A warm dreadnought guitar handcrafted from spruce and rosewood.", "🎸", 120, "rare", False),
        ("Rock Drum Set", "A complete five-piece drum kit with bronze cymbals and bass pedal.", "🥁", 350, "rare", False),
        ("Classic Violin", "A master craftsman violin producing hauntingly beautiful orchestral melodies.", "🎻", 260, "rare", False),
        ("Saxophone Jazz", "A gleaming brass alto saxophone filling late-night clubs with smooth jazz.", "🎷", 220, "rare", False),
        ("DJ Turntable", "Dual motorized scratch turntables with crossfader and digital waveforms.", "🎛️", 300, "rare", True),
        ("Musical Note Treble", "A shimmering golden treble clef floating with harmonic musical staves.", "🎼", 50, "common", True),
        ("Cinema Clapperboard", "The classic black-and-white film slate marking Scene 1, Take 1.", "🎬", 35, "common", False),
        ("Oscar Golden Statuette", "The coveted gold-plated Academy statuette recognizing brilliant artistry.", "🏆", 950, "legendary", True),
        ("Stage Spotlight", "A brilliant concert stage beam cutting through atmospheric theater haze.", "🔦", 80, "common", True),
        ("Studio Headphones", "High-fidelity open-back monitoring headphones for music producers.", "🎧", 140, "rare", False),
        ("Boombox Retro", "A heavy dual-cassette 1980s street beatbox with giant bass woofers.", "📻", 90, "common", False),
        ("Concert VIP Ticket", "An all-access backstage VIP laminate pass for your favorite musical tour.", "🎫", 200, "rare", False),
        ("Karaoke Party Mic", "A cordless singing mic with built-in Bluetooth speaker and echo reverb.", "🎤", 60, "common", False),
        ("Trumpet Fanfare", "A triumphant brass trumpet announcing arrivals with regal fanfares.", "🎺", 110, "common", False),
        ("Accordion Tunes", "A traditional bellows folk accordion playing cheerful continental dances.", "🪗", 95, "common", False),
        ("Harp Melodies", "An angelic golden concert harp strung with delicate melodic chords.", "🪕", 500, "epic", True),
        ("Bass Guitar Groove", "A four-string active bass delivering deep thunderous funk grooves.", "🎸", 160, "rare", False),
        ("Harmonica Blues", "A pocket-sized diatonic steel harmonica bending soulful midnight blues.", "🪗", 30, "common", False),
        ("Synth Synthesizer", "An analog modular synthesizer patched with patch cables and filter knobs.", "🎹", 420, "epic", True),
        ("Music Festival Pass", "Golden VIP wristband granting front-row access under the main stage laser lights.", "🎫", 250, "rare", False),
        ("Silver Flute", "A polished solid silver concert flute producing bird-like lyrical melodies.", "🪈", 190, "rare", False),
    ],
    "friendship": [
        ("High Five Buddy", "A cheerful golden high-five celebrating great team efforts and wins.", "✋", 15, "common", False),
        ("Friendship Bracelet", "A handwoven macrame bracelet braided with colorful threads of loyalty.", "📿", 25, "common", False),
        ("Golden Handshake", "Two clasped golden hands signifying mutual trust, honor, and respect.", "🤝", 100, "rare", True),
        ("Warm Hug", "A warm, comforting embrace providing emotional reassurance whenever needed.", "🫂", 20, "common", False),
        ("Thank You Flower", "A vibrant gerbera daisy holding a sweet card expressing heartfelt thanks.", "🌸", 15, "common", False),
        ("Pinky Promise", "Two intertwined little fingers sealing an unbreakable confidential pledge.", "🤙", 40, "common", False),
        ("Best Friends Lock", "An engraved golden padlock left on a river bridge to symbolize bond.", "🔒", 90, "rare", False),
        ("Coffee Chat Cup", "Two steaming mugs of coffee setting the stage for deep heart-to-heart talks.", "☕", 30, "common", False),
        ("Sunny Smile", "A glowing yellow sun sticker radiating pure happiness and cheerfulness.", "😊", 10, "common", False),
        ("Thumbs Up Gold", "A shiny golden thumbs-up acknowledging a job supremely well done.", "👍", 20, "common", False),
        ("Appreciation Award", "A crystal desktop plaque recognizing your constant kindness and support.", "🏅", 120, "rare", False),
        ("Gratitude Journal", "A leather journal to record cherished everyday moments shared with friends.", "📔", 45, "common", False),
        ("Cheer Up Sun", "A cute smiling cloud parting to reveal brilliant warm sunny beams.", "⛅", 35, "common", True),
        ("Sweet Fortune Cookie", "A crispy golden cookie cracking open to reveal an inspiring message.", "🥠", 15, "common", False),
        ("Friendship Knot", "An eternal Celtic knot woven from silver cords that never unravels.", "🪢", 80, "rare", False),
        ("Golden Clover", "A 14k gold-plated lucky clover wishing good fortunes to your closest friend.", "☘️", 150, "rare", True),
        ("Kindness Pebble", "A smooth river stone hand-painted with a positive daily mantra.", "🪨", 20, "common", False),
        ("Soulmate Compass", "An antique brass compass that always points directly toward true friends.", "🧭", 220, "rare", True),
        ("Shared Umbrella", "A wide yellow umbrella sheltering two dear companions from the storm.", "☂️", 50, "common", False),
        ("Loyal Heart Badge", "An enamel pin bearing two linked hearts honoring lifelong fidelity.", "❤️", 60, "common", False),
    ],
    "festivals": [
        ("Diwali Diya Lamp", "A traditional clay diya oil lamp radiating sacred light and prosperity.", "🪔", 50, "common", True),
        ("Diwali Sweets Box", "A lavish box of assorted kaju katli, ladoos, and festive Indian sweets.", "🍬", 80, "rare", False),
        ("Christmas Tree Pine", "A decorated evergreen pine topped with a golden star and twinkling lights.", "🎄", 150, "rare", True),
        ("Christmas Gift Stocking", "A red knit stocking overflowing with toys, chocolates, and holiday treats.", "🧦", 40, "common", False),
        ("Santa Hat Cheer", "A fuzzy red velvet Santa hat trimmed with snow-white plush fleece.", "🎅", 25, "common", False),
        ("New Year Fireworks", "A spectacular countdown pyrotechnic show welcoming a joyful new year.", "🎆", 250, "epic", True),
        ("Holi Gulal Colors", "Platters of fragrant organic pink, yellow, and turquoise powder dyes.", "🎨", 60, "common", True),
        ("Holi Water Pichkari", "A colorful water gun ready for playful splashing during the festival of colors.", "🔫", 35, "common", False),
        ("Eid Crescent Moon", "A glowing silver crescent moon accompanied by an auspicious twilight star.", "🌙", 120, "rare", True),
        ("Eid Lantern Fanous", "An ornate brass Ramadan lantern casting geometric shadows through stained glass.", "🏮", 90, "rare", True),
        ("Rakhi Sacred Thread", "A decorated wristband of silk and gold thread celebrating sibling bonds.", "🧶", 45, "common", False),
        ("Halloween Jack O Lantern", "A carved orange pumpkin glowing with a mischievous spooky candlelight grin.", "🎃", 50, "common", True),
        ("Navratri Dandiya Sticks", "A pair of carved wooden dandiya sticks decorated with bells for garba dance.", "🥢", 55, "common", False),
        ("Ganesh Modak Offering", "Steamed sweet rice dumplings filled with grated jaggery and coconut.", "🥟", 65, "common", False),
        ("Chinese Dragon Lantern", "A long silk dragon lantern weaving through lantern festival parades.", "🐉", 200, "rare", True),
        ("Hanukkah Menorah", "A silver nine-branch candelabra lit with the sacred festival of lights.", "🕎", 140, "rare", True),
        ("Thanksgiving Harvest Cornucopia", "A wicker horn overflowing with autumn gourds, corn, and grapes.", "🌽", 75, "common", False),
        ("St Patricks Gold Pot", "A black cauldron of gleaming gold coins at the end of a rainbow.", "🪙", 160, "rare", True),
        ("Easter Painted Egg", "A pastel porcelain egg painted with delicate floral spring patterns.", "🥚", 30, "common", False),
        ("Carnival Samba Feather", "A towering neon feather headdress worn during Rio carnival dancing.", "🪶", 130, "rare", True),
        ("Dia De Los Muertos Skull", "A brightly decorated sugar skull painted with marigolds and folk art.", "💀", 110, "rare", False),
        ("Japanese Origami Crane", "A paper bird folded with supreme precision bringing thousand-crane blessings.", "🕊️", 40, "common", False),
        ("Oktoberfest Beer Stein", "An authentic ceramic Bavarian stein with an embossed pewter lid.", "🍺", 70, "common", False),
        ("Mid Autumn Mooncake", "A rich baked pastry embossed with traditional patterns and lotus paste.", "🥮", 65, "common", False),
        ("Lohri Bonfire", "A blazing winter bonfire celebrating harvest with revari and groundnuts.", "🔥", 95, "common", True),
        ("Onam Pookkalam", "An intricate floor carpet composed entirely of fresh colorful flower petals.", "🌸", 125, "rare", False),
        ("Durga Puja Bell", "A ceremonial brass bell rung during divine autumn worship ceremonies.", "🔔", 85, "common", False),
        ("Ramadan Dates Plate", "Sweet Medjool dates served on a silver filigree dish for breaking fast.", "🌴", 45, "common", False),
        ("Summer Solstice Sun", "A pagan solar wheel honoring the longest sunlit day of the whole year.", "☀️", 175, "rare", True),
        ("Venice Carnival Mask", "A gold-leaf Venetian bauta mask worn through misty canal ballrooms.", "🎭", 220, "epic", True),
    ],
    "travel": [
        ("Jetliner Airplane", "A sleek commercial airliner taking flight toward dream vacation destinations.", "✈️", 90, "common", False),
        ("Hot Air Balloon", "A multicolored wicker basket balloon drifting gently across morning valleys.", "🎈", 140, "rare", True),
        ("Vintage Compass", "An aged brass navigational tool with magnetic needle guiding wanderers.", "🧭", 65, "common", False),
        ("World Globe Stand", "A spinning desktop globe showcasing continents and oceanic trade routes.", "🌐", 80, "common", False),
        ("Leather Travel Backpack", "A rugged canvas and leather rucksack packed for global backpacking journeys.", "🎒", 55, "common", False),
        ("Camper Van", "A retro wanderlust road-trip camper van parked beneath mountain pines.", "🚐", 160, "rare", False),
        ("Island Palm Tree", "Two swaying coconut palms on powdery white sands overlooking turquoise waters.", "🌴", 70, "common", False),
        ("Passport Boarding Pass", "A stamped explorer passport paired with a first-class ticket to adventure.", "🛂", 45, "common", False),
        ("Mountain Peak Conquer", "Snowcapped Himalayan alpine summits catching the morning sunrise glow.", "🏔️", 200, "rare", True),
        ("Ocean Cruise Ship", "A magnificent ocean liner cruising through deep blue Caribbean waves.", "🚢", 280, "rare", False),
        ("Camping Tent Campfire", "A cozy nylon dome tent pitched next to a crackling pine campfire.", "⛺", 75, "common", False),
        ("Tropical Postcard", "A vintage travel postcard stamped with warm wishes from sunny paradise.", "🏝️", 20, "common", False),
        ("Desert Pyramid", "The ancient monolithic golden pyramids rising from wind-swept Sahara dunes.", "🏜️", 220, "rare", False),
        ("Scuba Diving Mask", "Tempered-glass underwater goggles opening views to coral reef wonderlands.", "🤿", 60, "common", False),
        ("Eiffel Tower Miniature", "A bronze commemorative souvenir of the iconic Paris iron landmark.", "🗼", 85, "common", False),
        ("Parachute Skydive", "A colorful canopy soaring through open blue skies on an adrenaline dive.", "🪂", 130, "rare", True),
        ("Lighthouse Beacon", "A coastal stone lighthouse sweeping its warning beam across stormy seas.", "🏮", 110, "common", True),
        ("Road Trip Sign", "The famous Route 66 highway shield guiding cross-country road trips.", "🛣️", 40, "common", False),
        ("Luggage Suitcase", "A sturdy spinner suitcase covered in retro travel destination stickers.", "🧳", 50, "common", False),
        ("Canoe Paddle", "A carved cedar wood canoe floating calmly on a glassy mirror lake.", "🛶", 65, "common", False),
        ("Submarine Explorer", "A deep-sea submersible descending into the Mariana Trench's glowing depths.", "🤿", 650, "epic", True),
        ("Treasure Map Island", "A parchment map marked with an X leading to pirate buried gold chests.", "🗺️", 80, "common", False),
        ("Sleeping Bag Stargaze", "A thermal mummy sleeping bag under an open canopy of starry constellations.", "⛺", 50, "common", False),
        ("Binoculars Safari", "High-power roof prism binoculars spotting wildlife on the African savanna.", "🔭", 70, "common", False),
        ("Ancient Temple Relic", "A mossy stone idol discovered in the heart of lost jungle ruins.", "🗿", 340, "rare", True),
    ],
    "sports": [
        ("Golden Football Soccer", "A tournament match soccer ball finished in mirror-like polished gold.", "⚽", 120, "rare", True),
        ("Basketball Slam", "A pebble-grain leather basketball swishing through the hoop for the win.", "🏀", 50, "common", False),
        ("Tennis Racket Ball", "A graphite tournament racket paired with a fresh neon tennis ball.", "🎾", 60, "common", False),
        ("Gym Heavy Dumbbell", "Solid iron hexagonal dumbbell for building unstoppable strength and discipline.", "🏋️", 40, "common", False),
        ("Championship Gold Medal", "A heavy Olympic-style medallion suspended from a red, white, and blue ribbon.", "🥇", 250, "epic", True),
        ("Boxing Gloves", "A pair of laced red leather gloves ready for twelve rounds in the ring.", "🥊", 75, "common", False),
        ("Cricket Bat Ball", "An English willow cricket bat paired with a hand-stitched red leather ball.", "🏏", 85, "common", False),
        ("Golf Club Flag", "A titanium driver and dimpled golf ball resting near the 18th hole pin.", "⛳", 95, "common", False),
        ("Baseball Bat Glove", "An authentic maple wood bat and oiled leather catcher's mitt.", "⚾", 65, "common", False),
        ("Running Shoes Lightning", "Featherlight racing trainers leaving trails of electric neon speed.", "👟", 110, "rare", True),
        ("Skateboard Deck", "A seven-ply Canadian maple skateboard deck with custom street graffiti art.", "🛹", 70, "common", False),
        ("Surfboard Wave", "A fiberglass surfboard carving across a roaring turquoise ocean barrel.", "🏄", 130, "rare", True),
        ("Bicycle Cyclist", "A lightweight aerodynamic carbon-fiber road bike built for mountain stages.", "🚲", 140, "rare", False),
        ("Archery Target Arrow", "A carbon arrow striking dead center in the golden bullseye target.", "🎯", 90, "common", False),
        ("Bowling Strike Pins", "A marble bowling ball smashing all ten pins into a perfect strike.", "🎳", 55, "common", False),
        ("Ice Hockey Puck", "A vulcanized rubber puck rocketing across fresh ice toward the goal.", "🏒", 45, "common", False),
        ("Badminton Shuttlecock", "A goose-feather shuttlecock flying with lightning reflex speeds.", "🏸", 30, "common", False),
        ("Karate Black Belt", "The ultimate martial arts ranking sash denoting master level discipline.", "🥋", 160, "rare", False),
        ("Stopwatch Timer", "A precision split-second digital chronometer capturing record times.", "⏱️", 35, "common", False),
        ("Protein Shake Shaker", "A gym shaker bottle blending high-performance workout nutrients.", "🥤", 25, "common", False),
        ("Snowboard Freestyle", "A twin-tip freestyle snowboard landing corkscrew spins in deep powder.", "🏂", 150, "rare", True),
        ("Kettlebell Swing", "A cast-iron competition kettlebell building explosive hip and core drive.", "🏋️", 45, "common", False),
        ("Championship Ring", "A massive iced-out championship ring engraved with victory franchise lore.", "💍", 900, "legendary", True),
        ("Climbing Carabiner", "Aircraft-grade aluminum carabiner locking safely on steep granite cliffs.", "🧗", 35, "common", False),
        ("Water Polo Ball", "A textured waterproof ball splashed across intense aquatic match play.", "🤽", 30, "common", False),
    ],
    "fashion": [
        ("Luxury Handbag", "A quilted leather designer purse finished with an interlocking gold clasp.", "👜", 450, "epic", True),
        ("Red Velvet Lipstick", "A chic golden tube of iconic crimson lipstick delivering dramatic elegance.", "💄", 40, "common", False),
        ("Designer High Heels", "Stiletto patent-leather pumps famous for their signature red lacquered soles.", "👠", 320, "rare", False),
        ("Elegant Perfume Bottle", "A crystal flacon holding notes of French jasmine, vanilla, and bergamot.", "🧴", 180, "rare", True),
        ("Golden Sunglasses", "Aviator shades with polarized amber lenses and slender gold titanium frames.", "🕶️", 85, "common", False),
        ("Silk Scarf", "A hand-rolled Italian twill silk scarf printed with equestrian motifs.", "🧣", 110, "common", False),
        ("Makeup Glam Brush", "A set of ultra-soft synthetic rose-gold brushes for flawless makeup blending.", "🖌️", 60, "common", False),
        ("Pearl Necklace Strands", "A double row of lustrous south sea pearls draped with timeless class.", "📿", 650, "epic", True),
        ("Diamond Earrings", "A pair of brilliant round diamond studs sparkling in three-prong platinum.", "💎", 550, "epic", True),
        ("Stylish Fedora Hat", "A wool felt fedora with a grosgrain ribbon bow adding timeless flair.", "🎩", 75, "common", False),
        ("Shimmering Eyeshadow", "A 12-pan palette of ultra-pigmented metallic, satin, and matte pigments.", "🎨", 50, "common", False),
        ("Nail Polish Glamour", "High-shine quick-dry gel lacquer in a bold ruby-red finish.", "💅", 20, "common", False),
        ("Designer Trench Coat", "The quintessential double-breasted honey gabardine weather coat.", "🧥", 380, "rare", False),
        ("Vanity Mirror Lights", "A hollywood studio mirror surrounded by glowing warm spherical bulbs.", "🪞", 160, "rare", True),
        ("Gold Brooch Pin", "A vintage filigree brooch shaped like a diamond-encrusted dragonfly.", "🧷", 220, "rare", False),
        ("Leather Wallet Card", "A slim vegetable-tanned Italian leather wallet with RFID protection.", "👛", 90, "common", False),
        ("Diamond Tiara Sparkle", "A dainty hair crown studded with pavé crystals for prom and gala nights.", "👑", 700, "legendary", True),
        ("Beauty Skincare Serum", "An anti-aging hyaluronic moisture booster in an amber dropper bottle.", "🧪", 65, "common", False),
        ("Runway Fashion Dress", "An haute couture evening gown of cascading midnight silk and sequins.", "👗", 850, "legendary", True),
        ("Bespoke Bow Tie", "A handcrafted black silk satin bow tie tailored for black-tie galas.", "🎀", 45, "common", False),
        ("Diamond Bracelet Tennis", "A double row of round brilliant diamonds draping the wrist with elegance.", "💎", 750, "legendary", True),
        ("Vintage Pocket Watch", "An engraved gold hunter-case pocket watch passed down through generations.", "⏱️", 280, "rare", False),
        ("Silk Kimono Robe", "Hand-painted Japanese silk robe blossoming with delicate golden cranes.", "👘", 320, "rare", False),
        ("Golden Hairpin Blossom", "An imperial hair accessory carved with jade petals and gold filigree.", "🪷", 140, "common", False),
        ("Leather Biker Jacket", "A classic heavy-grain black motorcycle jacket with chrome asymmetrical zippers.", "🧥", 400, "epic", False),
    ],
    "cars": [
        ("Red Ferrari Supercar", "A mid-engine twin-turbo V8 exotic screaming to an 8,000 RPM redline.", "🏎️", 1800, "legendary", True),
        ("Blue Lamborghini Hypercar", "An all-wheel-drive V12 beast with scissor doors and razor-sharp angles.", "🚗", 2200, "legendary", True),
        ("Vintage Classic Roadster", "A 1960s convertible with chrome wire wheels and British racing green paint.", "🚘", 950, "epic", False),
        ("Muscle Car GT", "An American supercharged V8 muscle machine with dual racing stripes.", "🏎️", 650, "rare", False),
        ("Luxury SUV", "A commanding full-size luxury SUV with air suspension and massage seats.", "🚙", 800, "rare", False),
        ("Formula1 Race Car", "The pinnacle of open-wheel motorsport technology and aerodynamic downforce.", "🏎️", 3000, "mythic", True),
        ("Electric Hypercar Future", "A quad-motor 2,000 horsepower EV hypercar accelerating 0-60 in 1.8 seconds.", "⚡", 2600, "mythic", True),
        ("Cyber Truck", "An angular stainless-steel exoskeleton electric truck built for planetary exploration.", "🛻", 900, "epic", True),
        ("Speed Tachometer", "A glowing digital gauge revving red into the high-octane danger zone.", "📟", 70, "common", True),
        ("Turbocharger Boost", "A polished aluminum twin-scroll turbine whistling with forced induction.", "🌀", 180, "rare", True),
        ("Gold Rim Alloy Wheel", "A forged 21-inch directional alloy wheel dipped in champagne gold.", "🛞", 250, "rare", False),
        ("Racing Helmet", "A lightweight carbon helmet painted with aggressive motorsport livery.", "⛑️", 110, "common", False),
        ("Checkered Finish Flag", "The historic black-and-white flag waving victory at the finish line.", "🏁", 30, "common", False),
        ("Nitro NOS Bottle", "A pressurized blue bottle injecting nitrous oxide for instant horsepower surges.", "🧪", 150, "rare", True),
        ("Drift Sports Coupe", "A tuned rear-wheel-drive drift coupe producing plumes of tire smoke.", "🏎️", 500, "rare", True),
        ("Royal Rolls Phantom", "The supreme pinnacle of quiet luxury, lambswool carpets, and handcraft.", "🚘", 2400, "legendary", False),
        ("Monster Truck Tires", "A gigantic 66-inch heavy tread tire that crushes everything in its path.", "🚚", 350, "rare", False),
        ("Offroad 4x4 Jeep", "A lifted rock-crawler equipped with winch, snorkel, and mud-terrain tires.", "🚙", 420, "rare", False),
        ("Sport Motorcycle Bike", "A 1000cc Japanese supersport motorcycle carving corners at knee-dragging angles.", "🏍️", 480, "rare", True),
        ("Keyless Car Keyfob", "A sleek chrome vehicle fob with remote start and horn confirmation.", "🔑", 40, "common", False),
    ],
    "space": [
        ("Cosmic Rocket", "A massive multi-stage heavy-lift rocket roaring toward outer planetary orbits.", "🚀", 500, "epic", True),
        ("Ringed Planet Saturn", "The gas giant jewel of the solar system surrounded by icy crystalline rings.", "🪐", 350, "rare", True),
        ("Glowing Supernova Star", "A massive dying star detonating into brilliant pulses of light and matter.", "⭐", 650, "epic", True),
        ("Spacewalk Astronaut", "An astronaut floating in zero gravity against the curved blue horizon of Earth.", "🧑‍🚀", 280, "rare", False),
        ("Alien UFO Saucer", "A glowing metallic flying saucer humming with anti-gravity tractor beams.", "🛸", 400, "epic", True),
        ("Meteor Shooting Star", "A blazing celestial rock burning bright streaks across the night atmosphere.", "🌠", 90, "common", True),
        ("Deep Space Telescope", "An orbital observatory unfolding golden hexagonal beryllium mirrors.", "🔭", 800, "legendary", True),
        ("Spiral Galaxy Swirl", "A billion-star pinwheel galaxy turning gracefully across cosmic time.", "🌌", 950, "legendary", True),
        ("Solar Flare Sun", "The roiling nuclear furnace of our star erupting in magnetic plasma loops.", "☀️", 300, "rare", True),
        ("Lunar Moon Craters", "A glowing full moon showing ancient impact seas and white crater rays.", "🌕", 80, "common", False),
        ("Satellite Orbit", "A telecommunications satellite relaying global signals from geostationary orbit.", "🛰️", 160, "common", False),
        ("Black Hole Vortex", "A supermassive gravitational singularity bending space and light into an abyss.", "🕳️", 1200, "mythic", True),
        ("Space Shuttle Launch", "An iconic delta-wing orbiter riding solid rocket boosters into orbit.", "🚀", 450, "rare", True),
        ("Cosmic Nebula Cloud", "A stellar nursery of interstellar dust glowing in ionized magenta and cyan.", "✨", 550, "epic", True),
        ("Mars Rover Explorer", "An autonomous robotic geologist analyzing red desert soils on the fourth rock.", "🤖", 220, "rare", False),
        ("Constellation Ursa", "The celestial Great Bear pattern linked by shimmering silver starlight lines.", "✨", 110, "common", False),
        ("Comet Ice Tail", "A dirty snowball from the Oort cloud streaming an azure ion tail across space.", "☄️", 190, "rare", True),
        ("Wormhole Portal", "A shortcut through spacetime folded between distant cosmic galaxies.", "🌀", 1500, "mythic", True),
        ("Alien Crystal Rock", "A radioactive alien meteorite humming with unearthly neon green energy.", "💎", 320, "rare", True),
        ("Interstellar Probe", "An unmanned robotic messenger carrying humanity's golden record into deep void.", "📡", 400, "rare", False),
        ("Pulsar Lighthouse", "A spinning neutron star sweeping relativistic radiation beams across the cosmos.", "⭐", 750, "epic", True),
        ("Space Station Habitat", "A modular orbital habitat where scientists conduct zero-g experiments.", "🛰️", 850, "legendary", True),
        ("Solar Sail Vessel", "Gleaming reflective polymer sails propelled across stars by solar photon pressure.", "⛵", 920, "legendary", True),
        ("Alien Flora Spore", "A luminous botanical plant from Proxima Centauri glowing in alien indigo.", "🌺", 380, "rare", True),
        ("Event Horizon Probe", "The fearless deep-space probe transmitting final telemetry from the event horizon.", "📡", 620, "epic", True),
    ],
    "magic": [
        ("Magical Wizard Wand", "A core of phoenix feather encased in twisted hazel wood producing sparks.", "🪄", 180, "rare", True),
        ("Glowing Crystal Orb", "A polished sphere of mountain quartz holding captive swirling auroras.", "🔮", 250, "rare", True),
        ("Bubbling Magic Cauldron", "A cast-iron kettle bubbling with emerald potions and mystical vapors.", "🫕", 130, "common", True),
        ("Ancient Scroll Runes", "Parchment inscribed in luminous magical symbols that pulse when read.", "📜", 90, "common", False),
        ("Mythical Unicorn Horn", "A pearlescent spiraled alicorn radiating purity and healing radiance.", "🦄", 800, "legendary", True),
        ("Enchanted Golden Lamp", "An ornate brass oil lamp waiting to be rubbed to summon the grand genie.", "🪔", 600, "epic", True),
        ("Phoenix Feather Flame", "A burning vermilion quill that rekindles from its own glowing embers.", "🪶", 450, "rare", True),
        ("Sorcerer Spell Hat", "A pointed purple velvet hat embroidered with silver moons and constellations.", "🧙", 70, "common", False),
        ("Mystic Amulet Gem", "An eye-shaped pendant that warns its wearer of approaching dark sorcery.", "🧿", 210, "rare", True),
        ("Flying Magic Carpet", "A Persian silk rug floating silently through starlit palace skies.", "🧞", 550, "epic", True),
        ("Fairy Dust Bottle", "A corked glass vial holding sparkling glitter that grants the gift of flight.", "✨", 65, "common", True),
        ("Alchemist Elixir Flask", "A triangular glass beaker transmuting base metals into pure gold liquid.", "🧪", 160, "common", True),
        ("Enchanted Hourglass", "A brass timepiece whose glowing sands flow backwards to rewind moments.", "⏳", 380, "rare", True),
        ("Runic Stone Magic", "Ancient runic pebbles glowing with elemental frost and thunder powers.", "🪨", 110, "common", False),
        ("Mystic Tarot Cards", "A gilded deck of mystical cards revealing hidden truths and destinies.", "🃏", 95, "common", False),
        ("Dragon Breath Flame", "A condensed orb of pure dragon fire burning with primordial crimson fury.", "🔥", 700, "epic", True),
        ("Magic Mushroom Glow", "Bioluminescent fairy toadstools thriving in enchanted midnight groves.", "🍄", 40, "common", True),
        ("Celestial Grimoire", "A heavy spellbook bound in dragonhide locked with a star-shaped clasp.", "📖", 500, "rare", False),
        ("Teleport Magic Circle", "An intricate glowing geometric seal sketched on stone allowing instant jumps.", "⭕", 420, "rare", True),
        ("Crystal Gem Cluster", "Naturally grown amethyst and quartz crystals pulsing with harmonic vibrations.", "💎", 280, "rare", False),
    ],
    "animated": [
        ("Floating Hearts Animated", "A romantic cascade of floating pink and red hearts drifting across the view.", "💖", 150, "rare", True),
        ("Rose Petals Rain", "A poetic shower of velvety crimson petals falling gently like fragrant snow.", "🌹", 180, "rare", True),
        ("Dancing Teddy Bear", "A happy little brown bear grooving and spinning with playful party moves.", "🧸", 200, "rare", True),
        ("Sparkling Diamond Glow", "A flawless brilliant diamond pulsating with dazzling prisms and starlight rays.", "💎", 350, "epic", True),
        ("Grand Firework Burst", "A continuous celebratory barrage of chrysanthemums and golden palm shells.", "🎆", 450, "epic", True),
        ("Golden Crown Radiance", "An imperial crown emitting shimmering golden shockwaves and heavenly light.", "👑", 500, "epic", True),
        ("Floating Helium Balloons", "A buoyant bunch of shiny metallic balloons bobbing and swaying in the air.", "🎈", 120, "common", True),
        ("Magical Shooting Stars", "Streaks of brilliant silver fire slicing across deep twilight skies.", "🌠", 220, "rare", True),
        ("Rainbow Neon Burst", "An explosion of vivid kaleidoscopic colors bursting into festive shockwaves.", "🌈", 280, "rare", True),
        ("Golden Dragon Flight", "An imperial dragon swooping across the screen breathing golden sparklers.", "🐉", 800, "legendary", True),
        ("Celebration Confetti Rain", "Endless showers of metallic gold, magenta, and cyan confetti flakes.", "🎊", 160, "rare", True),
        ("Heart Explosion Pulse", "A huge pulsing crimson heart that shatters into a thousand floating smiles.", "💥", 320, "rare", True),
        ("Neon Laser Vibe", "Intense geometric laser beams dancing across your screen like a music festival.", "⚡", 250, "rare", True),
        ("Electric Thunderbolt Shock", "Crackling blue-white plasma bolts striking down with thunderous energy.", "⚡", 300, "rare", True),
        ("Glowing Portal Swirl", "A spinning dimensional gateway pulling stars into a vortex of cyan light.", "🌀", 600, "legendary", True),
        ("Flame Tornado Spin", "A spiraling twister of wild crimson and gold fire reaching toward the sky.", "🔥", 650, "epic", True),
        ("Water Splash Ripple", "Crystal water droplets creating concentric expanding mirror ripples.", "💧", 110, "common", True),
        ("Golden Coin Shower", "A jackpot torrent of minted gold coins raining down onto your screen.", "🪙", 400, "epic", True),
        ("Butterfly Flutter Swarm", "A cloud of iridescent blue Morpho butterflies dancing around in circles.", "🦋", 270, "rare", True),
        ("Cosmic Aurora Borealis", "Shifting curtains of neon green and violet northern lights dancing in space.", "🌌", 550, "epic", True),
        ("Disco Mirror Ball", "A spinning faceted mirror ball throwing hundreds of dancing spotlights.", "🪩", 230, "rare", True),
        ("Matrix Code Stream", "Cascading digital green glyphs and algorithms raining down cyberspace.", "💻", 380, "rare", True),
        ("Angel Wings Flutter", "Feathered white wings unfurling with gentle, comforting holy breezes.", "🪽", 700, "legendary", True),
        ("Glowing Halo Hover", "A golden circle of divine warmth hovering gently above with soft sparkles.", "😇", 340, "rare", True),
        ("Supernova Blast Wave", "A cosmic explosion rippling outward in incandescent rings of stardust.", "💥", 900, "mythic", True),
        ("Lightning Plasma Ball", "An electrified glass sphere with interactive tendrils of purple lightning.", "🔮", 420, "rare", True),
        ("Sparkling Fairy Spark", "A darting sprite of fairy light tracing magical glowing trails in the air.", "🧚", 190, "common", True),
        ("Vortex Energy Sphere", "A concentrated ball of kinetic power pulsing with raw unstable energy.", "🌐", 480, "rare", True),
        ("Holographic Glitch Cube", "A futuristic 3D wireframe cube shifting between digital reality layers.", "🧊", 520, "epic", True),
        ("Mystic Flame Orb", "A spherical fireball burning without fuel, casting warm comforting glows.", "🔥", 310, "rare", True),
    ],
    "emotional": [
        ("Warm Bear Hug", "An embrace that melts away worries and brings safe, unconditional comfort.", "🫂", 20, "common", False),
        ("Holding Hands Solidarity", "Two hands joined together promising that you will never walk alone.", "🤝", 25, "common", False),
        ("Cup Of Comfort Soup", "A warm steaming bowl of homemade chicken soup soothing tired spirits.", "🍲", 15, "common", False),
        ("Gentle Band Aid", "A heart-stamped adhesive bandage symbolizing quick emotional healing.", "🩹", 10, "common", False),
        ("Peaceful Dove Olive", "A gentle white dove carrying an olive branch of reconciliation and calm.", "🕊️", 60, "common", False),
        ("Bright Sunshine Hope", "A radiant sun breaking through gray skies to promise brighter tomorrows.", "☀️", 30, "common", False),
        ("Strength Flex Arm", "A flexing bicep celebrating your remarkable inner resilience and power.", "💪", 25, "common", False),
        ("Listening Ear", "A caring friend who is always here to listen patiently without any judgment.", "👂", 20, "common", False),
        ("Shoulder To Lean On", "A dependable supportive presence ready to carry half your heavy burden.", "🧑‍🤝‍🧑", 35, "common", False),
        ("Calming Lavender Candle", "A fragrant candle promoting deep tranquility and peaceful night sleep.", "🕯️", 30, "common", False),
        ("Breath Of Fresh Air", "A refreshing breeze that clears the mind and re-energizes tired souls.", "🍃", 15, "common", False),
        ("Rainbow After Rain", "The beautiful arch of colors reminding us that every storm runs out of rain.", "🌈", 75, "common", True),
        ("Comfort Blanket Fluffy", "A soft knit weighted blanket wrapping you in peaceful warmth.", "🛋️", 45, "common", False),
        ("Soft Pillow Clouds", "Cloud-like memory pillows providing the ultimate restful sanctuary.", "☁️", 25, "common", False),
        ("You Got This Ribbon", "An award rosette reminding you that you possess everything to succeed.", "🎗️", 20, "common", False),
        ("Cheering Megamouth", "A loud supportive cheerleader rooting for your triumph from the front row.", "📣", 30, "common", False),
        ("Smile Badge Pin", "A cheerful yellow smiley pin to wear close and pass smiles to everyone.", "😊", 10, "common", False),
        ("Warm Woolen Mitten", "Cozy hand-knit mittens warming cold fingers during winter storms.", "🧤", 15, "common", False),
        ("Soothing Teacup", "A cup of hot chamomile and clover honey soothing anxious feelings.", "🍵", 20, "common", False),
        ("Anchor Stability", "A heavy iron anchor keeping your boat steady through life's wildest seas.", "⚓", 80, "rare", False),
    ],
    "achievements": [
        ("Golden First Place Trophy", "The premier victory cup awarded to undisputed champions of the arena.", "🏆", 350, "epic", True),
        ("Diamond Star Award", "A multi-faceted star trophy carved from pure optical crystal.", "⭐", 450, "epic", True),
        ("Champion Gold Medal", "A heavy minted first-place medallion hung on a ceremonial silk ribbon.", "🥇", 200, "rare", True),
        ("Graduation Cap Diploma", "An Oxford academic mortarboard and parchment tied with crimson ribbon.", "🎓", 150, "rare", False),
        ("Laurel Wreath Victory", "Ancient golden olive branches crowning intellectual and poetic masters.", "🌿", 280, "rare", True),
        ("Blue Ribbon First", "The historic first-prize agricultural and creative achievement rosette.", "🎗️", 40, "common", False),
        ("MVP Shield Badge", "A battle-tested crest designating the most valuable player of the tournament.", "🛡️", 180, "rare", False),
        ("Record Breaker Torch", "A blazing flame carried by pioneers who shatter historic human limits.", "🔥", 320, "rare", True),
        ("Hall Of Fame Plaque", "A bronze wall plaque immortalizing your legacy for future generations.", "🏛️", 500, "epic", False),
        ("Certificate Of Honor", "An illuminated calligraphy scroll formally commending exemplary deeds.", "📜", 60, "common", False),
        ("Key To The City", "A ceremonial antique key presented to visionary leaders and heroes.", "🗝️", 650, "epic", True),
        ("Golden Rosette Award", "A layered golden satin badge recognizing excellence in execution.", "🏅", 90, "common", False),
        ("Level Up Achievement", "An electrified gaming badge celebrating advancing to the next tier.", "🆙", 75, "common", True),
        ("Grandmaster Chess King", "The carved obsidian and gold king piece of unbeatable tactical masters.", "♟️", 400, "rare", False),
        ("Top Contributor Star", "A brilliant platinum star honoring relentless dedication to the community.", "🌟", 300, "rare", True),
        ("Legendary Master Belt", "A heavyweight leather championship belt plated with solid gold buckles.", "🥋", 850, "legendary", True),
        ("Golden Quill Writer", "The pen that wrote immortal literature, poems, and inspirational works.", "🪶", 220, "rare", False),
        ("Innovation Lightbulb", "An illuminated filament bulb honoring breakthrough paradigm shifts.", "💡", 110, "common", True),
        ("Milestone Flag Mount", "The flag planted firmly upon the summit of tough, grueling goals.", "🚩", 85, "common", False),
        ("Stellar Performance Cup", "A two-handled crystal cup awarded for truly awe-inspiring artistry.", "🏆", 600, "epic", True),
    ],
    "baby-kids": [
        ("Baby Rattle Toy", "A pastel rattle with gentle beads creating delightful melodic sounds.", "🪇", 20, "common", False),
        ("Rocking Horse Wood", "A hand-carved wooden rocking steed painted with non-toxic colors.", "🎠", 75, "common", False),
        ("Cute Pacifier Dummy", "A safe silicone pacifier soothing little babies to sweet dreams.", "🍼", 15, "common", False),
        ("Baby Milk Bottle", "A warm bottle of nourishing milk helping tiny ones grow strong.", "🍼", 15, "common", False),
        ("Cozy Baby Booties", "Hand-knit pastel wool socks keeping little toes wonderfully warm.", "🧦", 25, "common", False),
        ("Stuffed Teddy Bear", "A huggable plush companion watching over baby cribs through the night.", "🧸", 40, "common", False),
        ("Building Blocks ABC", "Wooden colorful alphabet cubes for stacking first towers and words.", "🧱", 35, "common", False),
        ("Rubber Ducky Yellow", "The classic cheerful yellow bath companion floating on soap suds.", "🦆", 20, "common", False),
        ("Baby Stroller Carriage", "A vintage prussian pram with folding sun canopy and smooth ride.", "🛒", 110, "rare", False),
        ("Colorful Xylophone", "Eight rainbow metal keys ready for first joyful musical compositions.", "🎼", 45, "common", False),
        ("Spinning Top Toy", "A classic metal top that hums harmonic chords as it spins in place.", "🪀", 30, "common", False),
        ("Cute Baby Onesie", "A soft 100% organic cotton jumpsuit printed with tiny yellow stars.", "👶", 35, "common", False),
        ("Diaper Pin Golden", "A traditional gold safety pin keeping diapers snug and secure.", "🧷", 20, "common", False),
        ("Crib Mobile Stars", "Rotating felt plush clouds, moons, and stars playing gentle lullabies.", "🌙", 65, "common", True),
        ("Storybook Fairy Tales", "A beautifully illustrated bedtime book opening doors to magical realms.", "📚", 40, "common", False),
        ("Plush Bunny Ears", "A cute headband with floppy white bunny ears for playful pretend games.", "🐰", 25, "common", False),
        ("Toy Train Locomotive", "A wooden steam train chugging cheerfully along miniature wooden tracks.", "🚂", 55, "common", False),
        ("Toy Drum Sticks", "A marching band snare drum letting little drummers keep the beat.", "🥁", 50, "common", False),
        ("Colorful Crayons Box", "A fresh 64-pack box of vibrant wax crayons for coloring masterpieces.", "🖍️", 30, "common", False),
        ("Floating Soap Bubbles", "Iridescent rainbow bubbles floating and popping gently in the garden.", "🫧", 20, "common", True),
    ],
    "seasonal": [
        ("Winter Snowflake Crystal", "A microscopic miracle of frozen hexagonal geometry reflecting light.", "❄️", 30, "common", True),
        ("Summer Shining Sun", "The glorious July sun warming beaches and ripening sweet summer fruit.", "☀️", 35, "common", True),
        ("Autumn Harvest Pumpkin", "A plump orange field pumpkin heralding harvest moon celebrations.", "🎃", 25, "common", False),
        ("Spring Flowering Branch", "An apple tree bough bursting into fragrant pink and white blossoms.", "🌸", 40, "common", False),
        ("Thunderstorm Lightning Cloud", "A dramatic dark thundercloud flashing with wild jagged lightning bolts.", "⛈️", 80, "rare", True),
        ("Colorful Weather Rainbow", "A seven-colored bridge connecting sunlit rain showers across the valley.", "🌈", 65, "common", True),
        ("Gentle Raindrops Cloud", "A friendly gray cloud providing nourishing spring rain to seedlings.", "🌧️", 20, "common", False),
        ("Autumn Golden Leaf", "A fallen sycamore leaf turning rich shades of burnt amber and bronze.", "🍂", 15, "common", False),
        ("Frosty Snowman Carrot", "A three-tier snow figure with coal eyes, stick arms, and carrot nose.", "⛄", 45, "common", False),
        ("Sunny Beach Umbrella", "A striped cabana umbrella shielding warm sand towels from midday sun.", "🏖️", 35, "common", False),
        ("Winter Woolen Beanie", "A thick knit winter toque topped with a giant fluffy pom-pom.", "🧢", 25, "common", False),
        ("Spring Tulip Sprout", "The very first green shoot pushing through thawing soil toward the sun.", "🌱", 20, "common", False),
        ("Stormy Tornado Wind", "A roaring cyclonic funnel dancing across the wild Midwestern plains.", "🌪️", 120, "rare", True),
        ("Crescent Starry Night", "A slim silver moon floating in deep indigo skies peppered with stars.", "🌙", 50, "common", False),
        ("Full Harvest Moon", "A gigantic copper-tinted moon illuminating the autumn fields all night.", "🌕", 70, "common", False),
        ("Falling Pinecone", "A fragrant resin-scented pinecone harvested from high alpine forests.", "🌲", 15, "common", False),
        ("Summer Sunglasses Cocktail", "Cool shades reflecting an iced tropical fruit drink by the pool.", "🍹", 45, "common", False),
        ("Winter Sled Snow", "A wooden toboggan ready for high-speed runs down neighborhood hills.", "🛷", 40, "common", False),
        ("Morning Dew Leaf", "Crystal spherical dew droplets resting on a fresh green garden leaf.", "🍃", 20, "common", False),
        ("Glowing Firefly Jar", "A glass mason jar illuminated by friendly flashing lightning bugs.", "🫙", 90, "rare", True),
    ],
    "limited-edition": [
        ("Genesis Crystal Heart", "The very first artifact ever forged in Chatty, humming with primordial code.", "💎", 10000, "mythic", True),
        ("Celestial Crown Chronos", "Forged in the heart of dying pulsars to master the flow of spacetime itself.", "👑", 8500, "mythic", True),
        ("Mythic Astral Dragon", "A cosmic dragon woven from dark matter and superheated plasma constellations.", "🐉", 9500, "mythic", True),
        ("Eternity Ouroboros Ring", "The serpent consuming its tail in eternal cyclic balance, set with void gems.", "💍", 7500, "mythic", True),
        ("Sovereign Imperial Throne", "The absolute master seat of planetary governance forged from adamantine.", "👑", 9000, "mythic", True),
        ("Void Walker Portal", "A swirling tear in dimensional fabric revealing uncharted multiverse realities.", "🌀", 8000, "mythic", True),
        ("Hyperion Supernova Core", "A stabilized pocket sun contained within magnetic antigravity tethers.", "☀️", 7800, "mythic", True),
        ("Phoenix Rebirth Crest", "Bestows the sacred blessing of never admitting defeat, rising anew from ash.", "🔥", 6500, "mythic", True),
        ("Cyber Matrix Cube", "The master cryptographic key that unlocks every encrypted ledger in existence.", "🧊", 7200, "mythic", True),
        ("Divine Seraphim Wings", "Six glorious wings of pure photon light spreading over the entire universe.", "🪽", 8800, "mythic", True),
        ("Time Travelers Pocketwatch", "Winds minutes backward and forward across forgotten historic timelines.", "⏱️", 6800, "mythic", True),
        ("Valkyrie Golden Spear", "The sacred weapon carried by Norse choosers of the heroic slain.", "🔱", 6000, "mythic", True),
        ("Atlantis Oceanic Trident", "Controls ocean tides, sea monsters, and submerged sunken palaces.", "🔱", 7000, "mythic", True),
        ("Solaris Golden Sun Chariot", "Drawn by four fire stallions racing the morning sun across the sky.", "🎠", 7600, "mythic", True),
        ("Nebula Stardust Vial", "Interstellar dust collected from the Pillars of Creation in deep cosmos.", "🧪", 5800, "mythic", True),
        ("Quantum Infinity Crystal", "Shifts simultaneously through all probable physical dimensions at once.", "💎", 8200, "mythic", True),
        ("Obsidian Night Blade", "Forged from volcanic dragon glass, absorbs all light in its surroundings.", "🗡️", 6200, "mythic", True),
        ("Luminescent Moon Goddess", "The celestial maiden who guides lonely wanderers through midnight mist.", "🌙", 7400, "mythic", True),
        ("Gilded Pegasus Reins", "Enables true flight across cloud castles for the purest of souls.", "🦄", 6900, "mythic", True),
        ("Archangels Holy Grail", "The legendary sacred chalice offering immortality, wisdom, and grace.", "🏆", 9900, "mythic", True),
        ("Frostfire Elemental Orb", "Balances opposing primordial forces of arctic frost and raging magma.", "🔮", 7100, "mythic", True),
        ("Auric Peacock Feather", "A sacred feather whose golden eye reflects the mysteries of destiny.", "🪶", 5500, "mythic", True),
        ("Chimera Mythic Emblem", "A shield uniting the lion, goat, and serpent in fierce harmonic power.", "🛡️", 6400, "mythic", True),
        ("Zodiac Celestial Wheel", "The revolving astrological clock charting planetary fates of civilizations.", "☸️", 8000, "mythic", True),
        ("Founder Hallmark Trophy", "The permanent heirloom trophy recognizing founding patrons of the network.", "🏆", 10000, "mythic", True),
    ],
}

def slugify(text):
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")

def generate_svg(gift, cat_meta):
    """
    Generates a unique, high-quality, transparent vector SVG for the given gift.
    """
    name = gift["name"]
    slug = gift["slug"]
    icon = gift["icon"]
    is_animated = gift["isAnimated"]
    rarity = gift["rarity"]
    price = gift["coinPrice"]
    c1, c2 = cat_meta["gradient"]
    accent = cat_meta["accent"]

    # Unique gradient IDs based on slug to avoid collision when inlined
    gid = f"g_{slug.replace('-', '_')}"
    glow_id = f"glow_{slug.replace('-', '_')}"
    
    # CSS Animation snippet if animated
    anim_style = ""
    anim_class = ""
    if is_animated:
        anim_style = """
        <style>
          @keyframes floatAnim {
            0%, 100% { transform: translateY(0px) scale(1); }
            50% { transform: translateY(-8px) scale(1.04); }
          }
          @keyframes pulseGlow {
            0%, 100% { filter: drop-shadow(0 0 12px rgba(255,255,255,0.45)); opacity: 0.95; }
            50% { filter: drop-shadow(0 0 24px rgba(255,215,0,0.8)); opacity: 1; }
          }
          @keyframes spinSlow {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          @keyframes shimmer {
            0% { opacity: 0.4; transform: scale(0.9); }
            50% { opacity: 1; transform: scale(1.15); }
            100% { opacity: 0.4; transform: scale(0.9); }
          }
          .anim-content { animation: floatAnim 3.2s ease-in-out infinite; transform-origin: center; }
          .anim-glow { animation: pulseGlow 2.5s ease-in-out infinite; }
          .anim-star { animation: shimmer 2s ease-in-out infinite; }
        </style>
        """
        anim_class = "anim-content"

    # SVG template
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" fill="none">
  <defs>
    <linearGradient id="{gid}_bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="{c1}" />
      <stop offset="100%" stop-color="{c2}" />
    </linearGradient>
    <radialGradient id="{gid}_halo" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="{accent}" stop-opacity="0.65" />
      <stop offset="60%" stop-color="{c1}" stop-opacity="0.25" />
      <stop offset="100%" stop-color="{c2}" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="{gid}_border" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.8" />
      <stop offset="50%" stop-color="{accent}" stop-opacity="0.5" />
      <stop offset="100%" stop-color="{c2}" stop-opacity="0.3" />
    </linearGradient>
    <filter id="{glow_id}" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="10" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>
  {anim_style}
  
  <!-- Outer Ambient Radial Aura -->
  <circle cx="128" cy="128" r="110" fill="url(#{gid}_halo)" />

  <!-- Shield Base Card (Rounded Hexagon / Rounded Rect) -->
  <rect x="28" y="28" width="200" height="200" rx="48" fill="url(#{gid}_bg)" stroke="url(#{gid}_border)" stroke-width="3" filter="url(#{glow_id})" opacity="0.95" />

  <!-- Inner Shimmer Layer -->
  <rect x="36" y="36" width="184" height="184" rx="40" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-opacity="0.3" />
  
  <!-- Decorative Background Elements -->
  <circle cx="128" cy="128" r="70" fill="#ffffff" fill-opacity="0.08" />
  <circle cx="128" cy="128" r="50" fill="none" stroke="#ffffff" stroke-opacity="0.15" stroke-dasharray="6 6" />

  <!-- Floating Sparkles -->
  <g class="anim-star" fill="{accent}">
    <path d="M 60 70 Q 65 75 70 75 Q 65 75 60 80 Q 65 75 60 70 Z" />
    <path d="M 195 75 Q 198 80 203 80 Q 198 80 195 85 Q 198 80 195 75 Z" />
    <path d="M 185 185 Q 190 190 195 190 Q 190 190 185 195 Q 190 190 185 185 Z" />
    <path d="M 65 180 Q 70 183 75 183 Q 70 183 65 186 Q 70 183 65 180 Z" />
  </g>

  <!-- Central Visual Glyph / Art -->
  <g class="{anim_class}" id="artwork">
    <circle cx="128" cy="120" r="48" fill="#ffffff" fill-opacity="0.22" filter="drop-shadow(0 8px 16px rgba(0,0,0,0.3))" />
    <text x="128" y="142" font-family="'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif" font-size="58" text-anchor="middle" filter="drop-shadow(0 4px 8px rgba(0,0,0,0.4))">
      {icon}
    </text>
  </g>

  <!-- Bottom Coin Value Pill -->
  <g id="price-tag">
    <rect x="76" y="196" width="104" height="26" rx="13" fill="#0f172a" fill-opacity="0.85" stroke="{accent}" stroke-width="1" />
    <circle cx="92" cy="209" r="6" fill="#facc15" stroke="#ca8a04" stroke-width="1" />
    <text x="92" y="212" font-family="system-ui, sans-serif" font-size="7" font-weight="900" fill="#78350f" text-anchor="middle">C</text>
    <text x="136" y="214" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="800" fill="#ffffff" text-anchor="middle">
      {price}
    </text>
  </g>
</svg>
"""
    return svg

def build_catalog():
    print("==================================================")
    print("CHATTY 600+ VIRTUAL GIFTS MARKETPLACE BUILDER")
    print("==================================================")

    # 1. Ensure target folders exist
    for c in CATEGORIES:
        server_folder = os.path.join(SERVER_PUBLIC_ASSETS, c["folder"])
        client_folder = os.path.join(CLIENT_PUBLIC_ASSETS, c["folder"])
        os.makedirs(server_folder, exist_ok=True)
        os.makedirs(client_folder, exist_ok=True)

    os.makedirs(SERVER_DATA_DIR, exist_ok=True)
    os.makedirs(CLIENT_GIFT_DIR, exist_ok=True)

    catalog = []
    category_map = {c["id"]: c for c in CATEGORIES}

    total_count = 0
    slug_set = set()
    name_set = set()
    id_set = set()

    for cat_id, items in ITEMS_DATA.items():
        cat_meta = category_map[cat_id]
        cat_name = cat_meta["name"]
        cat_folder = cat_meta["folder"]
        
        print(f"[*] Processing category: {cat_name} (Target: {cat_meta['target']}, Actual: {len(items)})")
        if len(items) != cat_meta["target"]:
            raise ValueError(f"Category {cat_name} count mismatch! Expected {cat_meta['target']}, got {len(items)}")

        for idx, item in enumerate(items):
            name, desc, icon, price, rarity, is_animated = item
            slug = slugify(name)
            gift_id = f"gift_{cat_folder}_{idx+1:02d}"

            # Check uniqueness
            if slug in slug_set:
                raise ValueError(f"Duplicate slug detected: {slug}")
            if name in name_set:
                raise ValueError(f"Duplicate name detected: {name}")
            if gift_id in id_set:
                raise ValueError(f"Duplicate gift_id detected: {gift_id}")

            slug_set.add(slug)
            name_set.add(name)
            id_set.add(gift_id)

            is_premium = price >= 500
            is_trending = idx % 5 == 0
            is_popular = idx % 4 == 0
            is_limited = cat_id == "limited-edition"
            is_new = idx < 3

            image_path = f"/assets/gifts/{cat_folder}/{slug}.svg"
            thumbnail_path = f"/assets/gifts/{cat_folder}/{slug}.svg"
            asset_type = "animated_svg" if is_animated else "svg"

            tags = [cat_id, cat_folder, rarity, slug.replace("-", " ")]
            if is_animated: tags.append("animated")
            if is_premium: tags.append("premium")
            if is_limited: tags.append("limited")
            if is_popular: tags.append("popular")

            gift_record = {
                "id": gift_id,
                "name": name,
                "slug": slug,
                "description": desc,
                "category": cat_name,
                "subcategory": cat_folder,
                "tags": tags,
                "coinPrice": price,
                "icon": icon,
                "image": image_path,
                "thumbnail": thumbnail_path,
                "animationAsset": f"anim_{slug}" if is_animated else "",
                "assetType": asset_type,
                "isAnimated": is_animated,
                "isPremium": is_premium,
                "isPopular": is_popular,
                "isTrending": is_trending,
                "isLimitedEdition": is_limited,
                "isNew": is_new,
                "isActive": True,
                "displayOrder": total_count + 1,
                "rarity": rarity,
                "gradient": cat_meta["gradient"],
                "badge": rarity.capitalize(),
                "color": f"from-{cat_meta['gradient'][0]} to-{cat_meta['gradient'][1]}",
            }

            # 2. Generate SVG and save to both server and client public asset folders
            svg_content = generate_svg(gift_record, cat_meta)
            
            server_file = os.path.join(SERVER_PUBLIC_ASSETS, cat_folder, f"{slug}.svg")
            client_file = os.path.join(CLIENT_PUBLIC_ASSETS, cat_folder, f"{slug}.svg")

            with open(server_file, "w", encoding="utf-8") as f:
                f.write(svg_content)
            with open(client_file, "w", encoding="utf-8") as f:
                f.write(svg_content)

            catalog.append(gift_record)
            total_count += 1

    print(f"\n[✓] Successfully generated {total_count} gifts across {len(CATEGORIES)} categories!")

    # 3. Write out JSON catalog file
    json_path = os.path.join(SERVER_DATA_DIR, "gifts-catalog.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2)
    print(f"[✓] Wrote JSON catalog to {json_path}")

    # 4. Write out JS catalog data module for server and client
    js_export_content = f"""/**
 * Autogenerated Gift Catalog Data (600 Unique Gifts Across 25 Categories)
 * Single Source of Truth for Web, Mobile, and Backend Seeding.
 */

export const GIFT_CATEGORIES = {json.dumps(CATEGORIES, indent=2)};

export const GIFTS = {json.dumps(catalog, indent=2)};

export default GIFTS;
"""
    server_js_path = os.path.join(SERVER_DATA_DIR, "gifts-catalog.data.js")
    with open(server_js_path, "w", encoding="utf-8") as f:
        f.write(js_export_content)
    print(f"[✓] Wrote Server JS catalog module to {server_js_path}")

    client_js_path = os.path.join(CLIENT_GIFT_DIR, "giftData.js")
    with open(client_js_path, "w", encoding="utf-8") as f:
        f.write(js_export_content)
    print(f"[✓] Updated Client giftData.js at {client_js_path}")

    # 5. Validation Check
    validate_catalog(catalog)

def validate_catalog(catalog):
    print("\n==================================================")
    print("RUNNING CATALOG & ASSET VALIDATION")
    print("==================================================")

    assert len(catalog) >= 600, f"Expected at least 600 gifts, found {len(catalog)}"
    print(f"[✓] Total gifts count: {len(catalog)} (Target >= 600 achieved)")

    slugs = set()
    names = set()
    ids = set()
    assets = set()
    categories_found = {}

    for g in catalog:
        # Unique ID
        assert g["id"] not in ids, f"Duplicate ID: {g['id']}"
        ids.add(g["id"])

        # Unique slug
        assert g["slug"] not in slugs, f"Duplicate slug: {g['slug']}"
        slugs.add(g["slug"])

        # Unique name
        assert g["name"] not in names, f"Duplicate name: {g['name']}"
        names.add(g["name"])

        # Valid price
        assert isinstance(g["coinPrice"], int) and g["coinPrice"] > 0, f"Invalid price for {g['slug']}: {g['coinPrice']}"

        # Image asset path must exist on disk
        server_asset_path = os.path.join(ROOT_DIR, "server/public", g["image"].lstrip("/"))
        client_asset_path = os.path.join(ROOT_DIR, "client/public", g["image"].lstrip("/"))

        assert os.path.isfile(server_asset_path), f"Missing server asset file: {server_asset_path}"
        assert os.path.isfile(client_asset_path), f"Missing client asset file: {client_asset_path}"

        # Ensure no two gifts share the same asset file
        assert g["image"] not in assets, f"Duplicate asset shared between gifts: {g['image']}"
        assets.add(g["image"])

        cat = g["category"]
        categories_found[cat] = categories_found.get(cat, 0) + 1

    assert len(categories_found) >= 25, f"Expected 25 categories, found {len(categories_found)}"
    print(f"[✓] Categories verified: {len(categories_found)} distinct categories")

    for cat_name, count in categories_found.items():
        assert count >= 20, f"Category '{cat_name}' has less than 20 gifts: {count}"

    print(f"[✓] Every category meets or exceeds 20 items!")
    print(f"[✓] All {len(catalog)} visual asset files verified on disk with 0 broken links!")
    print(f"[✓] Uniqueness verified across all IDs, Slugs, Names, and Assets!")
    print("==================================================")
    print("VALIDATION COMPLETED WITH 100% SUCCESS")
    print("==================================================")

if __name__ == "__main__":
    build_catalog()
