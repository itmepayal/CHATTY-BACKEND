#!/usr/bin/env python3
"""
Catalog Builder for Chatty Enterprise-Grade Virtual Gift Store
Generates 600 unique gifts across the exact 15 categories specified by user:
1. Love & Romance (50)
2. Flowers & Nature (40)
3. Cute Animals (45)
4. Pets & Companions (35)
5. Birthday & Celebration (45)
6. Friendship (35)
7. Festivals & Traditions (45)
8. Food & Drinks (40)
9. Luxury & Premium (45)
10. Fantasy & Magic (40)
11. Gaming & Entertainment (35)
12. Travel & Adventure (35)
13. Funny & Memes (30)
14. Special Occasions (40)
15. Seasonal & Limited Edition (40)
TOTAL: Exactly 600 unique gifts
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

CATEGORIES = [
    {"id": "love", "name": "Love & Romance", "folder": "love", "target": 50, "icon": "❤️", "gradient": ["#f43f5e", "#be123c"], "accent": "#fda4af"},
    {"id": "flowers", "name": "Flowers & Nature", "folder": "flowers", "target": 40, "icon": "🌸", "gradient": ["#10b981", "#047857"], "accent": "#6ee7b7"},
    {"id": "animals", "name": "Cute Animals", "folder": "animals", "target": 45, "icon": "🐼", "gradient": ["#f59e0b", "#b45309"], "accent": "#fde68a"},
    {"id": "pets", "name": "Pets & Companions", "folder": "pets", "target": 35, "icon": "🐶", "gradient": ["#d97706", "#92400e"], "accent": "#fcd34d"},
    {"id": "birthday", "name": "Birthday & Celebration", "folder": "birthday", "target": 45, "icon": "🎂", "gradient": ["#8b5cf6", "#6d28d9"], "accent": "#c4b5fd"},
    {"id": "friendship", "name": "Friendship", "folder": "friendship", "target": 35, "icon": "🤝", "gradient": ["#3b82f6", "#1d4ed8"], "accent": "#bfdbfe"},
    {"id": "festivals", "name": "Festivals & Traditions", "folder": "festivals", "target": 45, "icon": "🪔", "gradient": ["#ea580c", "#d97706"], "accent": "#fed7aa"},
    {"id": "food-drinks", "name": "Food & Drinks", "folder": "food-drinks", "target": 40, "icon": "🧁", "gradient": ["#f97316", "#c2410c"], "accent": "#fed7aa"},
    {"id": "luxury", "name": "Luxury & Premium", "folder": "luxury", "target": 45, "icon": "👑", "gradient": ["#eab308", "#a16207"], "accent": "#fef08a"},
    {"id": "fantasy-magic", "name": "Fantasy & Magic", "folder": "fantasy-magic", "target": 40, "icon": "🪄", "gradient": ["#9333ea", "#581c87"], "accent": "#e9d5ff"},
    {"id": "gaming", "name": "Gaming & Entertainment", "folder": "gaming", "target": 35, "icon": "🎮", "gradient": ["#a855f7", "#7e22ce"], "accent": "#f0abfc"},
    {"id": "travel", "name": "Travel & Adventure", "folder": "travel", "target": 35, "icon": "✈️", "gradient": ["#0284c7", "#0f766e"], "accent": "#bae6fd"},
    {"id": "funny-memes", "name": "Funny & Memes", "folder": "funny-memes", "target": 30, "icon": "😂", "gradient": ["#eab308", "#ca8a04"], "accent": "#fef08a"},
    {"id": "special-occasions", "name": "Special Occasions", "folder": "special-occasions", "target": 40, "icon": "🎉", "gradient": ["#ec4899", "#be185d"], "accent": "#fbcfe8"},
    {"id": "seasonal-limited", "name": "Seasonal & Limited Edition", "folder": "seasonal-limited", "target": 40, "icon": "💎", "gradient": ["#c026d3", "#0891b2"], "accent": "#a5f3fc"},
]

def slugify(text):
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "-", text)
    return text.strip("-")

def generate_svg(name, icon, cat_id, gradient_colors, accent_color, rarity, index):
    bg1, bg2 = gradient_colors
    badge_color = "#94a3b8"
    if rarity == "rare": badge_color = "#3b82f6"
    elif rarity == "epic": badge_color = "#a855f7"
    elif rarity == "legendary": badge_color = "#f59e0b"
    elif rarity == "mythic": badge_color = "#ec4899"

    shape_var = index % 5
    geom_elem = ""
    if shape_var == 0:
        geom_elem = f'<circle cx="100" cy="90" r="48" fill="{accent_color}" fill-opacity="0.25" stroke="{accent_color}" stroke-width="2" stroke-dasharray="4 2"/>'
    elif shape_var == 1:
        geom_elem = f'<rect x="55" y="45" width="90" height="90" rx="20" fill="{accent_color}" fill-opacity="0.2" stroke="{accent_color}" stroke-width="2"/>'
    elif shape_var == 2:
        geom_elem = f'<polygon points="100,38 148,126 52,126" fill="{accent_color}" fill-opacity="0.2" stroke="{accent_color}" stroke-width="2"/>'
    elif shape_var == 3:
        geom_elem = f'<polygon points="100,35 145,90 100,145 55,90" fill="{accent_color}" fill-opacity="0.22" stroke="{accent_color}" stroke-width="2"/>'
    else:
        geom_elem = f'<circle cx="100" cy="90" r="52" fill="none" stroke="{accent_color}" stroke-width="3" opacity="0.3"/><circle cx="100" cy="90" r="38" fill="{accent_color}" fill-opacity="0.15"/>'

    svg_content = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <defs>
    <linearGradient id="bgGrad_{index}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="{bg1}" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="{bg2}" stop-opacity="1"/>
    </linearGradient>
    <filter id="glow_{index}" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="6" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>
  <rect width="192" height="192" x="4" y="4" rx="36" fill="url(#bgGrad_{index})"/>
  <rect width="192" height="192" x="4" y="4" rx="36" fill="none" stroke="{accent_color}" stroke-width="3" stroke-opacity="0.45"/>
  {geom_elem}
  <circle cx="100" cy="90" r="32" fill="#ffffff" fill-opacity="0.12" filter="url(#glow_{index})"/>
  <text x="100" y="104" font-size="44" text-anchor="middle" dominant-baseline="central">{icon}</text>
  <g transform="translate(100, 160)">
    <rect x="-48" y="-12" width="96" height="20" rx="10" fill="{badge_color}" fill-opacity="0.9"/>
    <text x="0" y="2" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="9" font-weight="bold" fill="#ffffff" text-anchor="middle" letter-spacing="0.8">{rarity.upper()}</text>
  </g>
</svg>'''
    return svg_content

CAT_ITEMS = {
    # 1. Love & Romance (50)
    "love": [
        ("Red Rose", "A classic single red rose expressing pure, timeless romance.", "🌹", 15, "common", False),
        ("Pink Rose", "A tender pink rose symbolizing gentleness, sweetness, and admiration.", "🌸", 15, "common", False),
        ("Rose Bouquet", "A luxuriant bundle of fresh red and pink roses wrapped in satin ribbon.", "💐", 50, "rare", False),
        ("Diamond Heart", "A sparkling brilliant-cut diamond carved into a glowing radiant heart.", "💎", 500, "epic", True),
        ("Forever Love", "An infinity symbol interwoven with two golden hearts sealed for eternity.", "♾️", 350, "epic", True),
        ("Love Letter", "A vintage wax-sealed envelope filled with poetic handwritten devotion.", "💌", 20, "common", False),
        ("Heart Lock & Key", "An antique brass lock and key symbolizing love locked in secret devotion.", "🔐", 75, "rare", False),
        ("Cupid's Arrow", "A golden winged arrow dipped in enchanted love nectar.", "🏹", 120, "rare", True),
        ("Twin Swans", "Two elegant white swans floating together forming an ivory heart.", "🦢", 180, "rare", False),
        ("Teddy with Heart", "A plush cuddly teddy bear hugging a vibrant plush red heart.", "🧸", 60, "common", False),
        ("Heart Balloon Cluster", "A bouquet of metallic pink and scarlet heart helium balloons.", "🎈", 30, "common", False),
        ("Couple Under Starlight", "Two silhouettes embracing under a midnight sky of twinkling constellations.", "🌌", 250, "epic", True),
        ("Romantic Candlelight", "A pair of sculpted beeswax taper candles flickering warm golden glow.", "🕯️", 25, "common", False),
        ("Proposal Ring Box", "A velvet jewel box illuminated by a pinpoint LED showcasing an engagement ring.", "💍", 800, "legendary", True),
        ("Kiss In The Rain", "An impressionist silhouette of lovers sharing a translucent umbrella.", "☔", 90, "rare", False),
        ("Golden Love Locket", "A filigree 24-karat heart pendant opening to reveal precious memories.", "🏅", 220, "epic", False),
        ("Passionate Kiss", "A radiant pair of sculpted ruby lips leaving a kiss mark.", "💋", 40, "common", False),
        ("Soulmate Thread", "A mystical crimson ribbon connecting two destined fingertips across worlds.", "🧵", 160, "rare", True),
        ("Heart Shaped Box", "A decadent assortment of Belgian truffles packed in a velvet heart box.", "🍫", 45, "common", False),
        ("Venus Love Pearl", "A luminescent pink oyster pearl harvested beneath a full lovers moon.", "🦪", 300, "epic", True),
        ("Eternity Rose Dome", "An enchanted crimson rose preserved forever inside a crystal bell jar.", "🥀", 400, "legendary", True),
        ("Sweetheart Cupcake", "A velvety strawberry cupcake topped with sparkling edible sugar pearls.", "🧁", 20, "common", False),
        ("Ruby Heart Brooch", "A vintage Victorian brooch paved with pigeon-blood rubies.", "❤️‍🔥", 280, "epic", False),
        ("Love Potion No. 9", "A swirling glass vial of shimmering fuchsia elixir scented of wild jasmine.", "🧪", 150, "rare", True),
        ("Moonlit Lovers Bridge", "An arched stone footbridge draped in wisteria blossoms under moonlight.", "🌉", 210, "epic", False),
        ("Heart Key Necklace", "A platinum key with a heart bow worn next to the pulse of true affection.", "🔑", 110, "rare", False),
        ("Carved Heart Tree", "A venerable oak tree trunk gently inscribed with timeless initials.", "🌳", 65, "common", False),
        ("Crimson Velvet Ribbon", "A spool of royal velvet ribbon that ties eternal promises together.", "🎀", 25, "common", False),
        ("Serenade Guitar", "A warm rosewood acoustic guitar strumming romantic midnight melodies.", "🎸", 130, "rare", False),
        ("Diamond Tiara of Venus", "A dazzling platinum crown adorned with teardrop diamonds and pink sapphires.", "👑", 950, "legendary", True),
        ("Sweetheart Macarons", "A pastel tower of raspberry and rosewater Parisian macarons.", "🍥", 35, "common", False),
        ("Heartfire Sparkler", "A hand-held sparkler that dances with brilliant heart-shaped fireworks.", "🎇", 40, "common", True),
        ("Lovebirds on Branch", "Two colorful lovebirds perching shoulder-to-shoulder on a cherry twig.", "🐦", 70, "rare", False),
        ("Golden Cupid Figurine", "A miniature solid gold statuette of Cupid resting upon a cloud.", "👼", 320, "epic", False),
        ("Sweet Whispers Seashell", "A spiral pink conch shell echoing gentle words across distant tides.", "🐚", 85, "rare", False),
        ("Amethyst Heart Geode", "A natural hollow crystal stone filled with deep violet quartz hearts.", "🔮", 190, "rare", False),
        ("Starlight Date Night", "A cozy picnic blanket laid out with strawberries and champagne under stars.", "🧺", 115, "rare", False),
        ("Rose Gold Compact", "A polished rose-gold mirror engraved with sweet secret reminders.", "🪞", 55, "common", False),
        ("Heart Neon Glow Sign", "A retro neon glass tube radiating vibrant magenta light on dark brick.", "💡", 140, "rare", True),
        ("Romantic Gondola Cruise", "A traditional Venetian gondola gliding gently down moonlit canals.", "🛶", 260, "epic", False),
        ("Love Melody Music Box", "An ornate maple music box playing a gentle lullaby when unwound.", "🎶", 175, "rare", False),
        ("Secret Admirer Bouquet", "An anonymous gathering of wild violets and baby breath tied with twine.", "🌾", 30, "common", False),
        ("Fluffy Love Cloud", "A dreamy pink cotton cloud raining sparkling heart-shaped glitter.", "☁️", 95, "rare", True),
        ("Heart Crystal Prism", "A faceted crystal prism casting romantic rainbow beams across the room.", "🌈", 80, "rare", False),
        ("Enchanted Carousel Horse", "A vintage carousel stallion adorned with pink roses and golden stirrups.", "🎠", 230, "epic", False),
        ("True Love Compass", "A celestial brass nautical compass pointing eternally toward one true heart.", "🧭", 195, "rare", True),
        ("Romantic Sunset Sail", "A twin-masted schooner silhouetted against a golden-orange horizon.", "⛵", 270, "epic", False),
        ("Crimson Silk Scarf", "A feather-light mulberry silk scarf carrying the scent of perfume.", "🧣", 60, "common", False),
        ("Infinity Love Knot", "A seamless platinum Celtic knot symbolizing devotion without end.", "🪢", 380, "epic", True),
        ("Royal Lover Scepter", "An ornate gilded scepter crowned with a pulsating star-ruby heart.", "🪄", 1200, "mythic", True)
    ],

    # 2. Flowers & Nature (40)
    "flowers": [
        ("Sunflower Radiance", "A towering golden sunflower radiating warmth and positive sunshine.", "🌻", 20, "common", False),
        ("Cherry Blossom Twig", "A delicate spring sakura branch bursting with pastel pink petals.", "🌸", 25, "common", False),
        ("Royal Lotus Blossom", "A serene sacred lotus floating serenely atop tranquil emerald waters.", "🪷", 80, "rare", True),
        ("Midnight Blue Rose", "A rare mystical cobalt rose said to grant profound wisdom.", "💙", 140, "rare", True),
        ("Lavender Field Bundle", "A fragrant bunch of Provençal lavender bound with natural linen twine.", "🪻", 30, "common", False),
        ("Golden Orchid", "An exotic rain-forest orchid with petals brushed in shimmering 24k gold.", "🌼", 220, "epic", True),
        ("White Calla Lily", "An immaculate trumpet lily embodying purity, grace, and new beginnings.", "🤍", 35, "common", False),
        ("Bonsai Harmony Tree", "A century-old miniature juniper bonsai rooted on weathered granite.", "🪴", 160, "rare", False),
        ("Wildflower Meadow", "A cheerful spray of buttercups, cornflowers, and scarlet poppies.", "🌾", 25, "common", False),
        ("Rare Black Orchid", "A velvet midnight-petaled orchid whispered in ancient botanist tales.", "🖤", 310, "epic", True),
        ("Crimson Hibiscus", "A tropical Hawaiian hibiscus bursting with sun-drenched crimson vitality.", "🌺", 40, "common", False),
        ("Morning Dewdrop Leaf", "A glossy emerald monstera leaf bearing a perfect crystalline dewdrop.", "🍃", 15, "common", False),
        ("Four-Leaf Clover", "A miraculously rare emerald clover bearing serendipitous good fortune.", "🍀", 95, "rare", True),
        ("Enchanted Willow Branch", "Weeping willow fronds glowing with soft bioluminescent green motes.", "🌿", 110, "rare", False),
        ("Tulip Festival Basket", "A woven wicker trug filled with vibrant multicolored Holland tulips.", "🌷", 55, "common", False),
        ("Crystal Daisy", "A sculpted quartz flower catching sunlight and refracting bright spectrums.", "✨", 175, "rare", True),
        ("Autumn Maple Foliage", "A fiery cluster of scarlet, amber, and burnt-orange autumn leaves.", "🍁", 30, "common", False),
        ("Mystic Fern Frond", "An unfurling silver fern revealing ancient primordial patterns.", "🌱", 20, "common", False),
        ("Prickly Bloom Cactus", "A miniature desert succulent crowned with a shocking pink desert blossom.", "🌵", 35, "common", False),
        ("Moonlight Water Lily", "An ivory lily whose petals only open beneath the light of the moon.", "🌙", 200, "epic", True),
        ("Dandelion Wish Seed", "A fluffy dandelion head ready to send your deepest wish into the breeze.", "🌬️", 25, "common", False),
        ("Forest Pine Cone", "A fragrant highland pine cone dusted with fresh crisp mountain frost.", "🌲", 15, "common", False),
        ("Exotic Bird of Paradise", "An architectural crane blossom displaying vivid orange and indigo crests.", "🦚", 90, "rare", False),
        ("Floating Water Hyacinth", "A lilac river bloom that drifts gently on flowing clear currents.", "💧", 45, "common", False),
        ("Silver Moss Terrarium", "A glass apothecary jar hosting a thriving mossy miniature biome.", "🫙", 125, "rare", False),
        ("Golden Wheat Sheaf", "Sun-ripened ears of wheat symbolizing bountiful harvest and joy.", "🌾", 30, "common", False),
        ("Alpine Edelweiss", "A resilient velvety white flower plucked from the highest mountain crests.", "🏔️", 280, "epic", True),
        ("Fragrant Gardenia Bloom", "A velvety white blossom intoxicating the night air with sweet perfume.", "🍨", 50, "common", False),
        ("Emerald Bamboo Shoot", "A stalk of lucky green bamboo embodying resilience and eternal growth.", "🎋", 65, "common", False),
        ("Frosted Winter Rose", "A scarlet rose encapsulated inside a brilliant crystalline casing of ice.", "❄️", 350, "epic", True),
        ("Jasmine Garland", "A fragrant woven strand of fresh white star jasmine blossoms.", "📿", 40, "common", False),
        ("Carnation Token", "A ruffled pink carnation expressing heartfelt warmth and gratitude.", "💐", 25, "common", False),
        ("Ginkgo Biloba Fan", "A golden fan-shaped leaf from the ancient living tree of resilience.", "🍂", 70, "rare", False),
        ("Wild Violet Posy", "A humble collection of sweet purple violets gathered from dewy woods.", "💜", 30, "common", False),
        ("Tree of Life Sapling", "A mystical glowing seedling pulsing with the heartbeat of Mother Gaia.", "🌳", 600, "legendary", True),
        ("Saffron Crocus", "A purple mountain bloom bearing threads of precious crimson saffron.", "🧵", 150, "rare", False),
        ("Succulent Garden Bowl", "A ceramic shallow dish planted with jade, echeveria, and zebra hawarthia.", "🪴", 85, "rare", False),
        ("Magnolia Grandiflora", "An aristocratic cream-white flower with thick leathery fragrant petals.", "🤍", 60, "common", False),
        ("Sundew Carnivorous Bloom", "A jewel-like droplet leaf glistening like honey in the damp glade.", "🍯", 130, "rare", False),
        ("Eternal Eden Blossom", "A mythical celestial flower that blooms once every thousand years.", "🌺", 1100, "mythic", True)
    ],

    # 3. Cute Animals (45)
    "animals": [
        ("Playful Panda", "An adorable giant panda nibbling happily on tender sweet bamboo.", "🐼", 40, "common", False),
        ("Little Red Fox", "A bushy-tailed scarlet fox kit curling into a warm fluffy donut.", "🦊", 65, "common", False),
        ("Baby Koala Bear", "A fuzzy eucalyptus-loving koala hugging a fragrant smooth gum branch.", "🐨", 55, "common", False),
        ("Golden Lion Cub", "A courageous little lion cub letting out its first playful tiny roar.", "🦁", 120, "rare", False),
        ("Curious Otter", "A cheerful river otter floating on its back juggling a shiny smooth pebble.", "🦦", 80, "rare", False),
        ("Sleepy Sloth", "A gentle three-toed sloth taking life at a wonderfully relaxed pace.", "🦥", 35, "common", False),
        ("Baby Elephant", "A sweet calflike elephant spraying cool water droplets through its trunk.", "🐘", 110, "rare", False),
        ("Dancing Penguin", "A cheerful tuxedo-clad emperor chick sliding belly-first on the ice.", "🐧", 45, "common", True),
        ("Spotted Fawn", "A gentle baby deer with dappled spots resting under leafy glades.", "🦌", 75, "rare", False),
        ("Little Fluffy Bunny", "A lop-eared bunny twitching its pink nose and munching on clover.", "🐰", 30, "common", False),
        ("Tiny Hedgehog", "A miniature quill baby rolled into an adorable safe prickly sphere.", "🦔", 40, "common", False),
        ("Chirpy Bluebird", "A vibrant indigo songbird delivering bright melodies of glad tidings.", "🐦", 25, "common", False),
        ("Fluffy Alpaca", "A smiling Andean alpaca wearing a warm woven wool blanket of bright colors.", "🦙", 90, "rare", False),
        ("Baby Meerkat Scout", "An alert desert meerkat kit standing on tiptoes watching the sunrise.", "🐾", 50, "common", False),
        ("Little Brown Bear", "A roly-poly bear cub dipping a furry paw into a honey jar.", "🐻", 60, "common", False),
        ("Rainbow Chameleon", "A curious reptile shifting its scales through a spectrum of vivid neon tones.", "🦎", 140, "rare", True),
        ("Smiling Quokka", "The happiest creature on earth flashing an irresistibly contagious smile.", "🐹", 100, "rare", False),
        ("Baby Snow Leopard", "A spotted phantom kitten chasing its own remarkably fluffy tail.", "🐆", 250, "epic", True),
        ("Tiny Sea Turtle", "A newborn sea turtle scuttling determinedly toward warm ocean surf.", "🐢", 70, "rare", False),
        ("Sleepy Red Panda", "A rust-colored tree climber dozing high among mossy tree canopies.", "🐾", 85, "rare", False),
        ("Fluffy White Duckling", "A soft yellow duckling waddling cheerfully through fresh spring rain.", "🦆", 20, "common", False),
        ("Little Chipmunk", "A striped cheek-stuffer hoarding golden acorns for the coming winter.", "🐿️", 25, "common", False),
        ("Baby Dolphin Calf", "A playful ocean dolphin leaping into golden sunset sea foam.", "🐬", 175, "rare", True),
        ("Little Hoot Owl", "A wide-eyed baby barn owl turning its head with endless curiosity.", "🦉", 50, "common", False),
        ("Kangaroo Joey", "A springy little joey peeking curiously from its mothers safe pouch.", "🦘", 95, "rare", False),
        ("Tiny Green Tree Frog", "A lime-green red-eyed frog perched snugly on a tropical rainforest leaf.", "🐸", 35, "common", False),
        ("Baby Giraffe", "A long-legged newborn giraffe trying to find its footing on the savannah.", "🦒", 130, "rare", False),
        ("Fluffy Woolly Sheep", "A cloud-like lamb bounding joyously over emerald rolling pasture.", "🐑", 30, "common", False),
        ("Little Walrus Pup", "A plump arctic walrus pup clapping its flippers on the frozen shore.", "🦭", 65, "common", False),
        ("Baby Polar Bear", "A pristine white bear cub rolling joyfully down snowy arctic drifts.", "🐻‍❄️", 220, "epic", True),
        ("Curious Raccoon", "A masked little bandit with clever paws washing a shiny red apple.", "🦝", 45, "common", False),
        ("Chirp Canary", "A golden songbird trilling melodies that brighten the gloomiest morning.", "🐤", 25, "common", False),
        ("Little Hippo Calf", "A round baby river hippo blowing bubbling kisses under warm waters.", "🦛", 105, "rare", False),
        ("Baby Toucan", "A tropical fledgeling with an oversized rainbow beak full of energy.", "🦜", 80, "rare", False),
        ("Woolly Mammoth Calf", "A prehistoric cuddly mammoth baby with tiny tusks and shaggy fur.", "🦣", 320, "epic", True),
        ("Tiny Gecko", "A friendly house gecko climbing glass windows with suction-cup toes.", "🦎", 20, "common", False),
        ("Baby Zebra", "A striped foal with long spindly legs galloping through savannah grasses.", "🦓", 115, "rare", False),
        ("Little Flamingo Chick", "A gray fluffy flamingo baby attempting its first one-legged balance.", "🦩", 75, "rare", False),
        ("Playful Seal Pup", "A big-eyed harp seal pup with fur white as fresh mountain snow.", "🦭", 90, "rare", False),
        ("Golden Peacock", "A miniature royal peacock fanning an iridescent wheel of jewel eyes.", "🦚", 280, "epic", True),
        ("Baby Lemur", "A ring-tailed lemur infant holding tightly to a sun-warmed jungle vine.", "🐒", 60, "common", False),
        ("Tiny Beaver Builder", "A busy little beaver kit chewing on twigs to build a fortress.", "🦫", 40, "common", False),
        ("Little Hummingbird", "A jewel of the air hovering invisibly fast to sip nectar from a blossom.", "🐦‍⬛", 85, "rare", False),
        ("Celestial Spirit Fox", "A mythical nine-tailed kitsune pup glowing with benevolent lunar starlight.", "🦊", 750, "legendary", True),
        ("Baby Phoenix Chick", "A fledgling bird of fire with feathers that warm the heart with hope.", "🐦‍🔥", 1250, "mythic", True)
    ],

    # 4. Pets & Companions (35)
    "pets": [
        ("Golden Retriever Pup", "A sunny-tempered golden puppy wagging its tail with boundless devotion.", "🐕", 60, "common", False),
        ("Persian Fluff Cat", "A luxurious long-haired Persian kitten purring softly on a velvet cushion.", "🐈", 60, "common", False),
        ("Corgi Wiggle", "A short-legged Pembroke Welsh Corgi proudly showing off its adorable peach loaf.", "🐕‍🦺", 85, "rare", True),
        ("Playful Calico Kitten", "A tri-colored kitten swatting vigorously at an imaginary wool butterfly.", "🐱", 40, "common", False),
        ("Chubby Hamster", "A golden hamster stuffing whole sunflower seeds into plump cheeks.", "🐹", 25, "common", False),
        ("Golden Fish in Bowl", "A sparkling fantail goldfish swimming peacefully in crystal clear water.", "🐠", 30, "common", False),
        ("French Bulldog Pup", "A bat-eared Frenchie snoring gently while dreaming of dog treats.", "🐶", 90, "rare", False),
        ("Siamese Royal Cat", "A blue-eyed seal point cat holding court with regal elegance.", "🐈‍⬛", 70, "rare", False),
        ("Pug in a Blanket", "A wrinkly pug bundled tightly like a cozy little warm burrito.", "🐾", 50, "common", False),
        ("Talking Parakeet", "A bright turquoise budgerigar chirping sweet greetings from its brass perch.", "🦜", 45, "common", False),
        ("Bichon Frise Cloud", "A powdered-sugar white dog looking exactly like a cheerful walking cloud.", "🐩", 75, "rare", False),
        ("Sleepy Ferret Scarf", "A long flexible ferret draped comfortably around its owner's neck.", "🦦", 55, "common", False),
        ("Loyal German Shepherd", "A noble shepherd pup holding its pointed ears high and alert.", "🐕", 110, "rare", False),
        ("Maine Coon Giant", "A majestic tufted-ear gentle giant with a magnificent bushy tail.", "🦁", 130, "rare", False),
        ("Dachshund Sausage Dog", "A long-bodied badger hound trotting enthusiastically across the rug.", "🌭", 65, "common", False),
        ("Mischievous Tabby", "A green-eyed tiger striped tabby planning its next climbing adventure.", "🐈", 35, "common", False),
        ("Shiba Inu Doge", "A fox-faced Japanese Shiba flashing the legendary knowing smile.", "🦊", 120, "rare", True),
        ("Gentle Bunny Netherland", "A miniature dwarf rabbit fitting comfortably into the palm of a hand.", "🐇", 40, "common", False),
        ("Beagle Tracker", "A floppy-eared beagle with an insatiable nose for adventure and bacon.", "🐶", 55, "common", False),
        ("Black Cat Good Luck", "A sleek midnight feline with golden eyes bringing protection and fortune.", "🐈‍⬛", 60, "common", False),
        ("Husky Snow Howl", "A blue-eyed Siberian husky singing the ancient song of arctic winds.", "🐺", 140, "rare", True),
        ("Scottish Fold Kitten", "An owl-faced kitten with folded ears looking up with pure innocence.", "🐱", 100, "rare", False),
        ("Chihuahua in Teacup", "A tiny feisty companion resting comfortably inside a porcelain teacup.", "☕", 50, "common", False),
        ("Guinea Pig Chorus", "A pair of fluffy guinea pigs squeaking excitedly for fresh lettuce.", "🐹", 30, "common", False),
        ("Boxer Joy Leap", "An energetic boxer pup bouncing on all four paws with joy.", "🥊", 70, "rare", False),
        ("Sphynx Warm Embrace", "A velvet-skinned hairless cat seeking the warmth of a loving lap.", "🧶", 150, "rare", False),
        ("Labrador Water Fetch", "A chocolate lab emerging from the lake carrying a prize floating toy.", "🎾", 80, "rare", False),
        ("Bengal Leopard Cat", "A domestic cat wearing the wild rosette coat of a jungle predator.", "🐆", 210, "epic", True),
        ("Pomeranian Puffball", "A tiny orange pom spinning circles like a fluffy dandelion seed.", "🐕", 95, "rare", False),
        ("Tortoiseshell Wise Cat", "A patchwork colored cat with endless attitude and deep affection.", "🐾", 45, "common", False),
        ("Bernese Mountain Pup", "A tricolor gentle giant with soulful brown eyes and giant paws.", "🏔️", 160, "rare", False),
        ("Ragdoll Floppy Hug", "A blue-eyed beauty that goes completely limp with trust when held.", "🧸", 125, "rare", False),
        ("Samoyed Smiley Pup", "A pure white cloud dog with a permanent happy grin that melts stress.", "☁️", 190, "rare", True),
        ("Golden Diamond Doge", "A solid 18k gold sculpted Shiba Inu wearing a sparkling diamond collar.", "💎", 850, "legendary", True),
        ("Astral Cat Companion", "A mystical feline woven from galaxy dust and purring cosmic comfort.", "🌌", 1150, "mythic", True)
    ],

    # 5. Birthday & Celebration (45)
    "birthday": [
        ("Triple Tier Birthday Cake", "A decadent three-layer vanilla sponge cake layered with butter-cream and berries.", "🎂", 50, "common", False),
        ("Golden Confetti Popper", "A metallic party cannon bursting with iridescent golden foil stars.", "🎉", 25, "common", True),
        ("Celebration Champagne", "A bottle of vintage Dom champagne popping its cork with effervescence.", "🍾", 120, "rare", True),
        ("Rainbow Balloon Bunch", "A vibrant bundle of helium balloons carrying cheerful birthday wishes.", "🎈", 30, "common", False),
        ("Birthday Crown Hat", "A shiny foil cone hat crowned with a fluffy pom-pom and tinsel trim.", "🥳", 15, "common", False),
        ("Birthday Gift Surprise", "A turquoise parcel wrapped in silk gold ribbon waiting to be torn open.", "🎁", 40, "common", False),
        ("Sparkling Candle Flame", "A golden numeral candle burning bright with wishes about to come true.", "🕯️", 20, "common", False),
        ("Party Blower Noise", "A paper party horn that unfurls with an enthusiastic buzzing cheer.", "🎊", 15, "common", False),
        ("Cupcake with Candle", "A red velvet cupcake topped with cream cheese frosting and a lit spark.", "🧁", 20, "common", False),
        ("Grand Fireworks Display", "A sky-shattering cascade of crimson, gold, and sapphire starlight.", "🎆", 200, "epic", True),
        ("Golden Birthday Banner", "A glittery cursive banner declaring Happy Birthday in brilliant style.", "🪧", 35, "common", False),
        ("Chocolate Fountain Dip", "A four-tier fountain of molten warm Swiss chocolate with fresh fruits.", "🍫", 160, "rare", False),
        ("Piñata Candy Explosion", "A colorful papier-mâché donkey bursting into a cascade of sweet treats.", "🪅", 75, "rare", True),
        ("Celebration Trumpet", "A gleaming brass trumpet playing a triumphant royal birthday fanfare.", "🎺", 60, "common", False),
        ("Sparkler Cake Fountain", "A restaurant-grade pyro fountain shooting brilliant cool silver sparks.", "🎇", 90, "rare", True),
        ("Birthday Queen Sash", "A satin pageant sash stamped in gold foil for the guest of honor.", "👑", 45, "common", False),
        ("Helium Number 18", "Giant metallic rose-gold foil numbers floating proudly at the entrance.", "1️⃣", 50, "common", False),
        ("Helium Number 21", "Gleaming silver foil milestone balloon standing tall at the party.", "2️⃣", 50, "common", False),
        ("Helium Number 30", "Gleaming golden milestone balloons catching the warm ballroom lights.", "3️⃣", 50, "common", False),
        ("Helium Number 50", "Majestic platinum celebration balloon honoring five decades of brilliance.", "5️⃣", 60, "common", False),
        ("Gourmet Donut Wall", "A wooden party board display hung with dozens of artisan glazed donuts.", "🍩", 85, "rare", False),
        ("Luminous Party Mask", "An illuminated LED masquerade mask pulsing in sync with dance music.", "🎭", 70, "rare", False),
        ("Midnight Confetti Rain", "A ceiling drop net raining millions of metallic flutter flakes.", "✨", 110, "rare", True),
        ("Candy Buffet Cart", "A vintage wheelcart packed with glass apothecary jars of vintage sweets.", "🍬", 130, "rare", False),
        ("Ice Cream Cake Slice", "A frosty wedge of cookies and cream gelato drizzled with hot fudge.", "🍰", 30, "common", False),
        ("LED Balloon Glow", "Clear orbs filled with fairy lights floating like captured stars.", "💡", 40, "common", False),
        ("Disco Mirror Ball", "A motorized faceted sphere casting thousands of moving light diamonds.", "🪩", 150, "rare", True),
        ("Macaron Tower Centerpiece", "A rainbow ombre pyramid of ninety delicate French almond treats.", "🍥", 175, "rare", False),
        ("Glitter Cocktail Toast", "Two crystal martini glasses shimmering with swirling edible luster dust.", "🍸", 65, "common", False),
        ("Birthday Mystery Box", "A sleek black box pulsing with mysterious radiant energy inside.", "📦", 95, "rare", False),
        ("Giant Birthday Card", "An oversized card covered with handwritten signatures and fond notes.", "📝", 25, "common", False),
        ("Starlight Photo Booth", "A shimmering sequin photo backdrop equipped with funny props and signs.", "📸", 100, "rare", False),
        ("Golden Champagne Tower", "A stacked pyramid of vintage coupe glasses overflowing with bubbly.", "🥂", 350, "epic", True),
        ("Birthday Wish Jar", "A hand-blown glass jar filled with folded origami paper wishing stars.", "⭐", 45, "common", False),
        ("Cotton Candy Cloud", "A fluffy spun-sugar cone glowing with an embedded LED wand.", "🍭", 35, "common", False),
        ("Silver Streamers Ceiling", "A shimmering canopy of metallic ribbons floating above the dance floor.", "🎏", 55, "common", False),
        ("Birthday Trophy Cup", "A polished golden goblet engraved 'Champion of the Year'.", "🏆", 140, "rare", False),
        ("Rainbow Layer Cake", "A vibrant six-color surprise cake revealing pure joy upon slicing.", "🌈", 65, "common", False),
        ("Golden Clapperboard", "A film production slate marked 'Best Life: Scene 1, Take 1'.", "🎬", 80, "rare", False),
        ("Party Favor Goodie Bag", "A luxe velvet pouch filled with miniature perfumes and sweets.", "🛍️", 50, "common", False),
        ("Singing Birthday Birdie", "A mechanical windup jewel bird that sings the birthday melody.", "🐦", 120, "rare", False),
        ("Golden Ticket Invite", "A shimmering foil-pressed VIP ticket admitting holder to unforgettable joy.", "🎟️", 90, "rare", False),
        ("Diamond Candle Stick", "A cut-crystal candleholder crowned with an eternal scented flame.", "🕯️", 210, "epic", False),
        ("Royal Birthday Throne", "An ornate crimson velvet armchair fit for royalty on their special day.", "🪑", 450, "epic", True),
        ("Celestial Birthday Nova", "A cosmic celebration supernova forming your name in interstellar starlight.", "🌟", 1500, "mythic", True)
    ],

    # 6. Friendship (35)
    "friendship": [
        ("Warm Hug", "A comforting embrace that melts worries away and reassures the soul.", "🤗", 20, "common", False),
        ("Pinky Promise", "Two linked little fingers sealing an unbreakable bond of mutual trust.", "🤙", 25, "common", False),
        ("Friendship Bracelet", "A hand-woven colorful cord knotted with genuine care and affection.", "🪢", 30, "common", False),
        ("Twin Boba Cups", "A pair of delicious brown sugar pearl milk teas for favorite companions.", "🧋", 35, "common", False),
        ("Besties High Five", "An energetic hand clap celebrating an everyday victory together.", "🙏", 15, "common", False),
        ("Care Package Box", "A thoughtfully curated box packed with cozy essentials and favorite snacks.", "📦", 75, "rare", False),
        ("You Are Awesome Mug", "A ceramic coffee mug stamped with daily reminders of how special you are.", "☕", 25, "common", False),
        ("Matching Keychains", "Two halves of a puzzle piece that fit together when paths cross.", "🗝️", 40, "common", False),
        ("Late Night Chat Tea", "A steaming pot of chamomile tea poured during heartfelt late-night talks.", "🫖", 30, "common", False),
        ("Listening Ear Token", "A gentle symbol representing unconditional patience and nonjudgment.", "👂", 20, "common", False),
        ("Shoulder to Lean On", "A sturdy soft cushion representing a steadfast refuge in stormy seasons.", "🛋️", 45, "common", False),
        ("Inside Joke Note", "A crumpled yellow sticky note that makes both of you burst into laughter.", "🗒️", 15, "common", False),
        ("Road Trip Playlist", "A vintage cassette mixtape recorded with songs that soundtracked memories.", "📼", 50, "common", False),
        ("Split Pizza Slice", "Two friends sharing the final glorious cheesy slice of a large pizza.", "🍕", 30, "common", False),
        ("Secret Vault Lock", "A miniature chest where secrets and vulnerabilities are safely kept forever.", "🔒", 90, "rare", False),
        ("Partners in Crime Badge", "A humorous golden badge awarded to your co-conspirator in mischief.", "🏅", 60, "common", False),
        ("Campfire Story Flame", "A warm flickering crackle of campfire embers under starry mountain skies.", "🪵", 70, "rare", False),
        ("Pocket Sunshine Token", "A polished golden pebble to keep in your pocket when skies turn grey.", "☀️", 55, "common", False),
        ("Umbrella in Storm", "Sharing a broad raincoat umbrella against sudden downpours of life.", "🌂", 40, "common", False),
        ("Cheer Up Flower Pot", "A small ceramic smile pot growing a plucky little bright daisy.", "🪴", 35, "common", False),
        ("Twin Milkshakes", "Two tall diner glasses with whipped cream and two red-and-white straws.", "🥤", 40, "common", False),
        ("Tandem Bicycle", "A vintage two-seater bicycle built for navigating life's ups and downs together.", "🚲", 130, "rare", False),
        ("Beacon of Support", "A miniature glowing lighthouse guiding friends home through foggy nights.", "🗼", 160, "rare", True),
        ("Warm Wool Socks", "A hand-knit pair of patterned socks delivering instant fuzzy warmth.", "🧦", 20, "common", False),
        ("Compass of Companionship", "A nautical compass that always points toward where your closest friends are.", "🧭", 110, "rare", False),
        ("Memory Scrapbook", "A leather-bound album filled with ticket stubs, photos, and wild stories.", "📖", 85, "rare", False),
        ("Emergency Chocolate Bar", "A giant dark chocolate bar reserved strictly for friendship emergencies.", "🍫", 25, "common", False),
        ("Popcorn Movie Bowl", "A tub of buttery movie popcorn with two hands reaching in at once.", "🍿", 30, "common", False),
        ("Friendship Locket Charm", "Two engraved silver halves that magnetically snap into one globe.", "📿", 95, "rare", False),
        ("Golden Loyalty Medal", "A heavyweight medal minted in gratitude for showing up through thick and thin.", "🥇", 180, "rare", False),
        ("Warm Blanket Fort", "A cozy haven built of cushions, fairy lights, and endless understanding.", "⛺", 120, "rare", False),
        ("Stargazing Blanket", "A woollen tartan blanket spread beneath constellations to dream together.", "🌠", 100, "rare", False),
        ("Heartfelt Thank You", "An embossed ivory note expressing gratitude too profound for casual speech.", "💌", 35, "common", False),
        ("Soul Bond Medallion", "An ancient interwoven silver token celebrating kinship born of spirit.", "🪙", 340, "epic", True),
        ("Eternal Friendship Beacon", "A luminous celestial gem glowing with the warmth of thirty years of shared memories.", "✨", 900, "legendary", True)
    ],

    # 7. Festivals & Traditions (45)
    "festivals": [
        ("Diwali Clay Diya", "A hand-painted terracotta oil lamp glowing with warmth and overcoming darkness.", "🪔", 25, "common", True),
        ("Christmas Pine Tree", "An evergreen fir decorated with glass baubles, silver tinsel, and a star.", "🎄", 60, "common", True),
        ("Golden Menorah", "A nine-branched candelabrum alight with the candles of Hanukkah miracles.", "🕎", 90, "rare", False),
        ("Eid Crescent & Star", "A golden crescent moon embracing a sparkling lantern celebrating Eid blessings.", "🌙", 70, "rare", True),
        ("Chinese Red Lantern", "A silk hanging lantern with golden tassels bringing luck and prosperity.", "🏮", 35, "common", False),
        ("Lunar New Year Red Envelope", "A scarlet packet stamped in gold foil containing blessings and fortune.", "🧧", 40, "common", False),
        ("Halloween Jack-O-Lantern", "A carved grinning orange pumpkin glowing warmly in the autumn dusk.", "🎃", 30, "common", False),
        ("Thanksgiving Cornucopia", "A woven horn of plenty brimming with squash, grapes, and harvest bounty.", "🌽", 50, "common", False),
        ("Holi Color Powders", "Vibrant bowls of magenta, turquoise, and saffron powders for festival fun.", "🎨", 45, "common", True),
        ("Easter Egg Basket", "A pastel painted wicker basket filled with decorated chocolate eggs.", "🧺", 35, "common", False),
        ("Hanami Picnic Set", "A lacquer bento box and sake flask enjoyed beneath falling cherry blossoms.", "🍱", 85, "rare", False),
        ("Carnival Feather Mask", "An extravagant Venetian mask exploding with peacock and ostrich plumes.", "🎭", 130, "rare", True),
        ("Oktoberfest Beer Stein", "A heavy lidded ceramic stein foaming with golden Bavarian brew.", "🍺", 45, "common", False),
        ("Saint Patrick Shamrock", "A vibrant green clover pinned in honor of Irish joy and celebration.", "☘️", 20, "common", False),
        ("Mid-Autumn Mooncake", "A lotus-seed pastry stamped with auspicious emblems around a salted yolk.", "🥮", 55, "common", False),
        ("Dia de los Muertos Calavera", "A decorated ceramic sugar skull adorned with marigolds and folk art.", "💀", 95, "rare", True),
        ("Santa Claus Sleigh", "A scarlet sleigh piled high with wrapped toys ready for midnight flight.", "🛷", 180, "rare", True),
        ("Nutcracker Soldier", "A carved wooden ceremonial sentry standing guard in festive uniform.", "💂", 65, "common", False),
        ("New Year Clock Midnight", "An antique clock with hands striking twelve amidst falling gold glitter.", "🕛", 150, "rare", True),
        ("Dragon Boat Drum", "A carved dragon prow boat rowing fast to the thunderous beat of festival drums.", "🛶", 120, "rare", False),
        ("Kwanzaa Kinara", "A seven-space wooden candleholder honoring heritage, unity, and purpose.", "🕯️", 75, "rare", False),
        ("Purim Hamentashen", "Triangular buttery pastries stuffed with sweet poppyseed and apricot jam.", "🥟", 30, "common", False),
        ("Songkran Water Bowl", "A chased silver bowl filled with scented water for New Year cleansing.", "🥣", 40, "common", False),
        ("Gretna Green Anvil", "A traditional blacksmith anvil sealing runaway marriages over hot sparks.", "🔨", 110, "rare", False),
        ("Loi Krathong Lotus Float", "A banana-leaf raft bearing candles and incense drifting down moonlit rivers.", "🪷", 80, "rare", True),
        ("Festive Gingerbread House", "A spicy gingerbread cottage frosted with royal icing and gumdrop tiles.", "🏠", 60, "common", False),
        ("Yule Log Fireplace", "A crackling oak log wrapped in birch bark and mistletoe in a warm hearth.", "🪵", 70, "rare", False),
        ("Carnival Samba Maracas", "A pair of hand-painted wooden gourds rattling rhythms of Rio.", "🪇", 40, "common", False),
        ("Tradition Tea Ceremony", "A cast-iron kettle and bamboo whisk preparing ceremonial jade matcha.", "🍵", 90, "rare", False),
        ("Midsummer Flower Crown", "A wild circlet of seven meadow blooms woven for the summer solstice.", "👑", 65, "common", False),
        ("Diwali Mithai Assortment", "A silver tray of kaju katli, gulab jamun, and saffron laddoo sweets.", "🍬", 50, "common", False),
        ("Saint Lucia Candle Wreath", "A crown of lingonberry boughs and glowing candles bearing light in winter.", "🕯️", 100, "rare", False),
        ("Ghirardelli Peppermint Bark", "Layers of dark and white chocolate studded with crushed candy canes.", "🍫", 35, "common", False),
        ("Festive Mistletoe Branch", "A sprig of green leaves and white berries promising sweet stolen kisses.", "🌿", 25, "common", False),
        ("Chinese Lion Dance Head", "A dramatic papier-mâché lion with blinking golden eyes and silken mane.", "🦁", 240, "epic", True),
        ("Eid Mubarak Kaaba Token", "A velvet jewel box containing a silver relief of the Holy Sanctuary.", "🕋", 210, "epic", False),
        ("Harvest Corn Doll", "A traditional wheat straw figure woven to preserve the spirit of the field.", "🌾", 45, "common", False),
        ("Festive Cracker Surprise", "A classic cardboard tube that snaps open with paper crowns and jokes.", "🧨", 20, "common", False),
        ("Golden Dreidel", "A spinning four-sided top cast in solid bronze celebrating great miracles.", "🎲", 60, "common", False),
        ("Rangoli Sand Art", "An intricate floor mosaic composed of colored quartz sand and flower petals.", "💮", 85, "rare", False),
        ("Epiphany Galette des Rois", "Flaky puff pastry stuffed with almond frangipane holding a hidden ceramic charm.", "🥧", 55, "common", False),
        ("Venetian Gondolier Hat", "A straw boater encircled by a red grosgrain ribbon from the Grand Canal.", "👒", 70, "rare", False),
        ("Thanksgiving Roasted Turkey", "A golden herb-basted roast centerpiece served on a sterling platter.", "🦃", 90, "rare", False),
        ("Imperial Dragon Cloak", "An emperor's festival silk robe embroidered with five-clawed golden dragons.", "👘", 550, "legendary", True),
        ("Eternal Celestial Lantern", "A sacred vessel burning with the unquenchable flame of world goodwill.", "🏮", 1350, "mythic", True)
    ],

    # 8. Food & Drinks (40)
    "food-drinks": [
        ("Gourmet Woodfired Pizza", "A bubbly Neapolitan crust topped with buffalo mozzarella and fresh basil.", "🍕", 35, "common", False),
        ("Sushi Master Platter", "An artisan assortment of fatty tuna nigiri, salmon roe, and avocado rolls.", "🍣", 90, "rare", False),
        ("Glazed Strawberry Donut", "A fluffy golden ring dipped in pink strawberry glaze and rainbow sprinkles.", "🍩", 15, "common", False),
        ("Artisan Cheeseburger", "A prime angus patty with melted aged cheddar, bacon, and brioche bun.", "🍔", 30, "common", False),
        ("Matcha Green Tea Latte", "Velvety steamed oat milk poured into ceremonial Uji matcha with latte art.", "🍵", 25, "common", False),
        ("Crunchy Golden Taco", "A crisp corn shell stuffed with seasoned carne asada, cotija, and cilantro.", "🌮", 20, "common", False),
        ("French Butter Croissant", "Layers upon layers of flaky golden pastry that shatter with every bite.", "🥐", 20, "common", False),
        ("Tropical Mango Smoothie", "Sun-ripened Alphonso mango blended with passionfruit and coconut cream.", "🥭", 25, "common", False),
        ("Wagyu Steak Dinner", "An A5 Japanese ribeye seared to perfection with truffled marrow butter.", "🥩", 220, "epic", False),
        ("Belgian Waffle Tower", "Crisp malted waffles piled high with fresh berries, cream, and maple syrup.", "🧇", 40, "common", False),
        ("Steaming Ramen Bowl", "Rich tonkotsu broth with hand-pulled noodles, soft egg, and braised chashu.", "🍜", 45, "common", False),
        ("Decadent Chocolate Cake", "Six layers of dark Valrhona ganache sponge dusted in cocoa powder.", "🍰", 35, "common", False),
        ("Iced Caramel Macchiato", "Bold espresso layered over vanilla milk with a crosshatch of rich caramel.", "☕", 25, "common", False),
        ("Truffle Fries Cone", "Crispy shoestring potatoes tossed in black summer truffle oil and parmesan.", "🍟", 30, "common", False),
        ("Italian Gelato Trio", "Hand-scooped cups of Bronte pistachio, dark chocolate, and Stracciatella.", "🍨", 35, "common", False),
        ("Sparkling Berry Cocktail", "Effervescent prosecco infused with blackberry liqueur and fresh thyme.", "🍸", 55, "common", False),
        ("Golden Dim Sum Basket", "A bamboo steamer holding crystal shrimp har gow and pork soup dumplings.", "🥟", 50, "common", False),
        ("Pancake Breakfast Stack", "A towering stack of buttermilk hotcakes crowned with melting salted butter.", "🥞", 35, "common", False),
        ("Chilled Coconut Water", "A freshly hacked green young coconut served cold with a paper straw.", "🥥", 20, "common", False),
        ("Artisan Sourdough Loaf", "A blistered dark crust country loaf with an airy, tangy wild-yeast crumb.", "🍞", 25, "common", False),
        ("Gourmet Cheese Board", "An arrangement of aged Manchego, Brie de Meaux, honeycomb, and figs.", "🧀", 85, "rare", False),
        ("Lobster Tail Thermidor", "Sweet Atlantic lobster broiled in a rich cream, cognac, and tarragon gratin.", "🦞", 180, "rare", False),
        ("Vintage Aged Whiskey", "An 18-year single malt scotch poured neat over a hand-carved ice sphere.", "🥃", 120, "rare", False),
        ("Churros with Dulce de Leche", "Crisp cinnamon-sugar pastry batons served with warm dipping caramel.", "🥖", 25, "common", False),
        ("Frosted Strawberry Milkshake", "An old-school soda fountain shake topped with whipped cream and a cherry.", "🥤", 30, "common", False),
        ("Spicy Butter Chicken", "Tender chicken simmered in a silky tomato, cashew, and fenugreek gravy.", "🍛", 45, "common", False),
        ("Crisp Golden Pretzel", "A Bavarian braided soft pretzel sprinkled with coarse salt with beer cheese.", "🥨", 20, "common", False),
        ("Wild Berry Acai Bowl", "Organic blended acai topped with chia seeds, banana slices, and granola.", "🫐", 35, "common", False),
        ("Belgian Beer Flight", "Four tulip tasting glasses featuring trappist ale, dubbel, and fruity lambic.", "🍻", 65, "common", False),
        ("Caviar on Mother of Pearl", "Royal Osetra sturgeon caviar served on traditional hand-carved shell.", "🦪", 300, "epic", True),
        ("Peking Duck Crepes", "Glistening crisp duck skin wrapped in warm Mandarin pancakes with scallions.", "🥢", 140, "rare", False),
        ("Artisan Hot Cocoa", "Velvety spiced Mexican chocolate topped with toasted vanilla marshmallows.", "☕", 25, "common", False),
        ("Warm Cinnamon Roll", "A spiral sweet dough roll dripping with warm cream cheese icing glaze.", "🍥", 25, "common", False),
        ("Spanish Seafood Paella", "Saffron bomba rice studded with prawns, mussels, chorizo, and sweet peas.", "🥘", 95, "rare", False),
        ("Crystal Sugar Apple", "A ruby red orchard apple coated in glass-like hard cinnamon crack sugar.", "🍎", 20, "common", False),
        ("Espresso Martini", "Vodka and coffee liqueur shaken hard with freshly pulled espresso to a dense foam.", "🍸", 60, "common", False),
        ("Oven Fresh Chocolate Cookie", "A thick bakery cookie with molten pockets of dark and milk chocolate.", "🍪", 15, "common", False),
        ("Golden Fondue Cauldron", "Gruyere and Emmental melted with white wine over a tabletop flame.", "🫕", 110, "rare", False),
        ("Rare Blue Mountain Coffee", "Freshly roasted Jamaican high-altitude beans steeped in a vacuum siphon.", "☕", 160, "rare", False),
        ("Amrita Nectar of Gods", "A legendary chalice overflowing with the sweet elixir of eternal celebration.", "🏆", 1200, "mythic", True)
    ],

    # 9. Luxury & Premium (45)
    "luxury": [
        ("Diamond Solitaire Watch", "A Swiss timepiece paved with brilliant diamonds and sapphire crystal.", "⌚", 550, "epic", True),
        ("Solid Gold Bullion Bar", "A 1-kilogram bar of 99.99% pure gold stamped by the royal treasury.", "🪙", 650, "epic", True),
        ("Royal Crown of Jewels", "A handcrafted velvet crown encrusted with sapphires, emeralds, and pearls.", "👑", 850, "legendary", True),
        ("Italian Luxury Supercar", "A roaring red mid-engine V12 supercar capable of exhilarating speed.", "🏎️", 1200, "legendary", True),
        ("Private Island Getaway", "A secluded turquoise atoll featuring white sandy beaches and palms.", "🏝️", 1800, "mythic", True),
        ("Mega Yacht Starlight", "A 300-foot multi-deck superyacht with a helipad and infinity swimming pool.", "🛥️", 2000, "mythic", True),
        ("Executive Private Jet", "A Gulfstream luxury aircraft prepared for transcontinental first-class voyages.", "🛩️", 1600, "mythic", True),
        ("Designer Haute Handbag", "An iconic handcrafted leather handbag with 24k gold turnlock hardware.", "👜", 400, "epic", False),
        ("Teardrop Emerald Pendant", "A flawless Colombian emerald set in platinum surrounded by diamonds.", "📿", 500, "epic", False),
        ("Champagne Crystal Flutes", "A pair of Baccarat crystal glasses cut by master glassblowers.", "🥂", 150, "rare", False),
        ("Silk Cashmere Overcoat", "A hand-tailored Italian coat woven from pure Mongolian white cashmere.", "🧥", 320, "epic", False),
        ("Black Platinum VIP Card", "An exclusive titanium charge card with unlimited global concierge perks.", "💳", 450, "epic", True),
        ("Penthouse Key Card", "Admittance to a triple-story skyline residence overlooking the city lights.", "🗝️", 750, "legendary", False),
        ("Rare Vintage Bordeaux", "A bottle of 1945 Chateau Margaux stored in subterranean temperature vaults.", "🍷", 600, "epic", False),
        ("Platinum Signet Ring", "A substantial platinum ring custom-engraved with an ancestral heraldic crest.", "💍", 280, "rare", False),
        ("Solid Gold Fountain Pen", "A mastercrafted writing instrument featuring an 18-karat iridium nib.", "🖋️", 220, "rare", False),
        ("Handcrafted Cigar Humidor", "Spanish cedar cabinet aging rare hand-rolled Havana corona puros.", "📦", 350, "epic", False),
        ("Diamond Tennis Bracelet", "A flexible row of fifty uniform brilliant-cut D-flawless diamonds.", "✨", 520, "epic", True),
        ("High-End Audio Headphones", "Audiophile open-back planar magnetic headphones trimmed in zebrano wood.", "🎧", 260, "rare", False),
        ("Silk Persian Carpet", "An authentic hand-knotted silk rug featuring millions of microscopic stitches.", "🧶", 700, "legendary", False),
        ("Limousine Service Key", "A chauffeured midnight stretch vehicle with blacked-out privacy glass.", "🚙", 300, "epic", False),
        ("Kobe Beef Master Feast", "A private chef teppanyaki tasting featuring rare Miyazaki beef and truffles.", "🥩", 420, "epic", False),
        ("Sculpted Marble Bust", "A classical portrait carved by an Italian sculptor from Carrara marble.", "🏛️", 480, "epic", False),
        ("Bespoke Savile Row Suit", "A hand-cut three-piece suit crafted from Super 180s worsted wool.", "👔", 380, "epic", False),
        ("Golden Pocket Watch", "An antique grandfather timepiece with exposed tourbillon escapement.", "⏱️", 310, "rare", False),
        ("Rare Black Pearl Earrings", "A matched pair of Tahitian peacock pearls hanging on platinum hooks.", "🦪", 460, "epic", False),
        ("Designer Sunglasses", "Aviator frames plated in 18k white gold with polarized gradient lenses.", "🕶️", 180, "rare", False),
        ("Luxury Fragrance Flacon", "A crystal flacon containing pure oud, damask rose, and ambergris oil.", "🧴", 290, "rare", False),
        ("Custom Motorcycle Cruiser", "A bespoke chrome chopper engine assembled with handcrafted precision.", "🏍️", 580, "epic", False),
        ("Helicopter Skyline Flight", "A private turbine helicopter flight over glittering nighttime skyscrapers.", "🚁", 490, "epic", True),
        ("Art Nouveau Crystal Vase", "A museum-quality Rene Lalique vase sculpted with dancing nymphs.", "🏺", 360, "epic", False),
        ("Gold Monogrammed Cufflinks", "Heavy 18k gold oval cufflinks inlaid with midnight black onyx.", "🪙", 200, "rare", False),
        ("Equestrian Champion Stallion", "A thoroughbred Arabian racehorse with lineage traceable for centuries.", "🐎", 880, "legendary", True),
        ("Sapphire Cocktail Ring", "A cushion-cut Ceylon royal blue sapphire flanked by tapered baguettes.", "💍", 620, "epic", True),
        ("Leather Executive Desk", "A walnut desk lined with saddle leather and concealed secret drawers.", "🪑", 340, "rare", False),
        ("Vintage Swiss Music Chest", "An 1880 cylinder music box playing overtures on tuned steel bells.", "🎵", 270, "rare", False),
        ("Fine Art Masterpiece", "An authenticated oil-on-canvas study by a world-renowned French master.", "🖼️", 920, "legendary", False),
        ("Sterling Tea Service Set", "A five-piece Victorian silver teapot, cream pitcher, and presentation tray.", "🫖", 390, "epic", False),
        ("Diamond Encrusted Skull", "A controversial contemporary art sculpture covered in thousands of gems.", "💀", 1100, "legendary", True),
        ("Armored Bank Vault Door", "A gleaming multi-ton circular steel vault guarding sovereign treasures.", "🚪", 820, "legendary", False),
        ("Luxury Villa in Tuscany", "An ancient restored stone estate surrounded by private vineyards and olive groves.", "🏡", 1450, "mythic", True),
        ("Golden Scepter of Kings", "A ceremonial wand held by monarchs at state coronations across empires.", "🪄", 1300, "mythic", True),
        ("Private Opera Box Seat", "Front-row red velvet private box at the Vienna State Opera House.", "🎭", 410, "epic", False),
        ("Superyacht Submarine", "A deep-sea personal submersible exploration vehicle with 360 acrylic dome.", "🤿", 1750, "mythic", True),
        ("The Sovereign Diamond Star", "A legendary 100-carat blue diamond whispered in the annals of kings.", "💎", 2500, "mythic", True)
    ],

    # 10. Fantasy & Magic (40)
    "fantasy-magic": [
        ("Magic Crystal Ball", "A swirling orb of smoky quartz revealing glimpses of past, present, and future.", "🔮", 120, "rare", True),
        ("Elder Wizard Wand", "A core of phoenix feather encased in twisted blackthorn and petrified wood.", "🪄", 180, "rare", True),
        ("Dragon Egg of Embers", "A scaled obsidian egg radiating gentle geothermal heat and ancient dragon breath.", "🥚", 350, "epic", True),
        ("Mystic Spellbook", "A leather grimoire bound with bronze clasps and filled with glowing runes.", "📖", 200, "epic", False),
        ("Healing Health Potion", "A vial of bubbling crimson liquid restoring vigor and vitality instantly.", "🧪", 40, "common", False),
        ("Mana Elixir of Stars", "An azure potion glowing with concentrated celestial arcane power.", "🍶", 45, "common", False),
        ("Enchanted Flying Broom", "A polished ash wood sweeper that floats gracefully above the treetops.", "🧹", 95, "rare", True),
        ("Mystic Tarot Deck", "A gilded box of seventy-eight cards painted with the Major and Minor Arcana.", "🃏", 60, "common", False),
        ("Cauldron of Mysteries", "A cast iron witch cauldron brewing a fragrant violet mist of secrets.", "🫕", 110, "rare", False),
        ("Fairy Dust Pouch", "A velvet drawstring purse filled with sparkling weightless levitation dust.", "✨", 50, "common", True),
        ("Phoenix Feather Quill", "A molted quill from an immortal firebird that never runs dry of ink.", "🪶", 240, "epic", True),
        ("Celestial Star Map", "An ancient parchment chart showing forgotten constellations and astral planes.", "🗺️", 85, "rare", False),
        ("Shadow Cloak of Invisibility", "A gossamer cloak that bends light and obscures the wearer completely.", "🧥", 400, "legendary", True),
        ("Amulet of Protection", "A talisman carved with protective sigils warding off negative energies.", "🧿", 75, "rare", False),
        ("Summoning Rune Stone", "A weathered river rock pulsing with an ethereal glowing Celtic knot.", "🪨", 65, "common", False),
        ("Golden Pegasus Statuette", "A carved miniature of the winged stallion poised to take flight.", "🦄", 220, "rare", False),
        ("Philosopher's Stone", "The legendary crimson alchemical artifact capable of transmuting metals.", "💎", 800, "legendary", True),
        ("Unicorn Horn Fragment", "A spiral horn tip radiating a soft calming aura of pristine purity.", "🦄", 320, "epic", True),
        ("Hourglass of Chronos", "Golden sand that can flow backwards when turned under the new moon.", "⏳", 290, "epic", True),
        ("Ring of Elements", "A brass band holding four spinning gems governing fire, water, earth, and air.", "💍", 175, "rare", False),
        ("Gargoyle Sentinel", "A stone gargoyle figurine that awakens to guard its bearer while sleeping.", "🗿", 130, "rare", False),
        ("Alchemist Scale", "Precision brass balances that weigh the intangible truth of spoken words.", "⚖️", 100, "rare", False),
        ("Astral Projection Mirror", "An antique silver mirror reflecting other dimensions and spiritual realms.", "🪞", 260, "epic", False),
        ("Mermaid Pearl Pendant", "A glowing sea gem pulled from the sunken ruins of ancient Atlantis.", "🧜‍♀️", 190, "rare", False),
        ("Griffin Feather Plume", "A fierce feather possessing the courage of a lion and eagle combined.", "🦅", 150, "rare", False),
        ("Enchanted Crystal Dagger", "A dagger blade knapped from pure amethyst that cuts through illusions.", "🗡️", 210, "rare", False),
        ("Witch Familiar Black Cat", "A magical miniature cat figurine with jade eyes that purrs telepathically.", "🐈‍⬛", 80, "rare", False),
        ("Fountain of Eternal Youth", "A vial of crystalline spring water reversing the toll of passing years.", "⛲", 600, "legendary", True),
        ("Scroll of Forbidden Lore", "A wax-sealed roll of papyrus holding spells that alter the natural order.", "📜", 165, "rare", False),
        ("Siren Conch Horn", "A pearlescent conch shell whose melody charms monsters of the deep.", "🐚", 140, "rare", False),
        ("Chalice of Avalon", "The sacred cup resting in the legendary mist-shrouded isle of heroes.", "🏆", 550, "epic", True),
        ("Bioluminescent Fairy Jar", "A mason jar holding three friendly woodland sprites who glow in the dark.", "🫙", 90, "rare", True),
        ("Wand of the High Archmage", "A staff topped with a rotating floating gyroscope of raw arcane light.", "🪄", 380, "epic", True),
        ("Runed Mithril Shield", "An elven buckler forged of light silver metal stronger than hardened steel.", "🛡️", 270, "epic", False),
        ("Elixir of Dreamwalking", "A smoky silver potion allowing the drinker to wander through other minds.", "🧪", 135, "rare", False),
        ("Crown of the Winter Fae", "A circlet sculpted of unbreakable frosted icicles and silver birch.", "👑", 420, "epic", True),
        ("Book of Shadows", "A generational grimoire holding spells of healing, protection, and earth.", "📚", 185, "rare", False),
        ("Enchanted Compass of Destiny", "A needle pointing not to north, but directly toward what you desire most.", "🧭", 310, "epic", True),
        ("The Cosmic Dragon Heart", "A pulsating core of an ancient star dragon that burns with the birth of suns.", "❤️‍🔥", 1400, "mythic", True),
        ("Infinity Tome of Creation", "The primer written before the cosmos began, holding the words of existence.", "📖", 2200, "mythic", True)
    ],

    # 11. Gaming & Entertainment (35)
    "gaming": [
        ("RGB Gaming Keyboard", "A mechanical clicky keyboard with customizable animated rainbow backlighting.", "⌨️", 75, "rare", True),
        ("Pro Esports Controller", "A precision wireless gamepad with hall-effect joysticks and trigger stops.", "🎮", 80, "rare", False),
        ("Retro Arcade Cabinet", "A classic 1980s standup coin-op machine loaded with nostalgic pixel classics.", "🕹️", 250, "epic", True),
        ("VR Headset Immersion", "Next-gen virtual reality goggles with eye-tracking and spatial audio.", "🥽", 300, "epic", True),
        ("Golden Gaming Trophy", "A gleaming statue awarded to tournament grand champions on the main stage.", "🏆", 150, "rare", False),
        ("High-End Graphics Card", "A monster triple-fan GPU capable of 4K ray-traced gaming at 144 frames.", "🖥️", 450, "epic", False),
        ("Studio Streamer Mic", "A broadcast-grade condenser microphone fitted with shock mount and pop filter.", "🎙️", 110, "rare", False),
        ("Curved Gaming Monitor", "An ultrawide 49-inch OLED display delivering an enveloping visual panorama.", "🖥️", 320, "epic", False),
        ("Gaming Headset Surround", "Wireless cans with zero-latency spatial sound to pinpoint enemy footsteps.", "🎧", 85, "rare", False),
        ("Pixel Heart Extra Life", "A retro 8-bit blinking red heart granting another chance at the final boss.", "❤️", 30, "common", True),
        ("Ergonomic Racing Chair", "A bucket seat gaming chair upholstered in breathable leather with lumbar support.", "🪑", 130, "rare", False),
        ("Level 99 Boss Badge", "An animated enamel pin awarded to players who conquered the impossible raid.", "🎖️", 95, "rare", True),
        ("Vintage Handheld Gameboy", "An olive-green screen pocket console running on two AA batteries.", "📟", 90, "rare", False),
        ("Speedrun Stopwatch", "A precision timer recording milliseconds on the quest for world records.", "⏱️", 45, "common", False),
        ("RGB Mousepad Mat", "A desk-spanning micro-woven surface bordered by customizable LED tubing.", "🖱️", 40, "common", False),
        ("Loot Crate Mystery Box", "A heavy steel lockbox containing randomized legendary game gear.", "📦", 70, "rare", True),
        ("Electric Rock Guitar", "A double-cutaway electric axe capable of screaming solos and heavy riffs.", "🎸", 160, "rare", False),
        ("Vinyl DJ Turntables", "A pair of direct-drive record decks with magnetic cartridges for scratching.", "🎛️", 220, "epic", False),
        ("Neon Game Room Sign", "A neon tube sign blazing 'GAMER ZONE' in electric cyan and magenta.", "💡", 65, "common", True),
        ("Critical Hit D20 Dice", "A twenty-sided resin polyhedral die that rolled a natural 20 for epic victory.", "🎲", 35, "common", True),
        ("Retro Cassette Tape", "A vintage cassette mixtape recorded with songs that soundtracked memories.", "📼", 25, "common", False),
        ("Wireless Gaming Mouse", "An ultralight honeycomb shell mouse gliding effortlessly on PTFE feet.", "🖱️", 60, "common", False),
        ("Gold Play Button Plaque", "An honorary wall plaque celebrating reaching one million loyal subscribers.", "▶️", 500, "epic", True),
        ("Concert Stage Spotlights", "A moving-head intelligent stage light washing the arena in vivid colors.", "🔦", 120, "rare", True),
        ("Synthesizer Keyboard", "An analog polyphonic synth packed with vintage filters and arpeggiators.", "🎹", 280, "epic", False),
        ("Esports Team Jersey", "A personalized moisture-wicking jersey worn by international champions.", "👕", 50, "common", False),
        ("Stream Deck Keypad", "A customizable fifteen-key LCD control board for seamless broadcast directing.", "🎚️", 95, "rare", False),
        ("Laser Tag Blaster", "A dual-mode infrared tagger with sound effects and vibration feedback.", "🔫", 55, "common", False),
        ("Retro CRT TV Screen", "A vintage curved glass cathode-ray tube television displaying scanlines.", "📺", 80, "rare", False),
        ("Gold Gaming Joystick", "A competition Sanwa fight stick built for fighting game tournament victory.", "🕹️", 175, "rare", False),
        ("Acoustic Drum Kit", "A five-piece birch drum set with polished cymbals and double bass pedal.", "🥁", 240, "epic", False),
        ("Popcorn Cinema Ticket", "Two VIP cinema tickets with front-row balcony seating and unlimited refills.", "🎟️", 40, "common", False),
        ("Gaming Room Nanoleaf", "Geometric wall light panels shifting colors in response to music and game audio.", "🏮", 140, "rare", True),
        ("Legendary Founder Pass", "An exclusive golden NFT badge denoting founding members of the guild.", "🪙", 650, "legendary", True),
        ("The Virtual World Core", "The omnipotent master mainframe processor powering the entire metaverse.", "🌐", 1500, "mythic", True)
    ],

    # 12. Travel & Adventure (35)
    "travel": [
        ("Hot Air Balloon Sunrise", "A brightly patterned basket soaring serenely over Cappadocia valleys.", "🎈", 140, "rare", True),
        ("Vintage Passport Stamp", "A leather passport book filled with official visa stamps from seven continents.", "🛂", 60, "common", False),
        ("Airplane Window View", "Looking out over a sea of pink cotton clouds during cruising altitude.", "✈️", 80, "rare", False),
        ("Eiffel Tower Miniature", "A bronze cast replica of Paris's iconic iron lady beacon of romance.", "🗼", 90, "rare", False),
        ("Taj Mahal Token", "A sculpted white marble monument to eternal love and architectural perfection.", "🕌", 110, "rare", False),
        ("Statue of Liberty Torch", "A gilded torch representing liberty, freedom, and welcoming opportunity.", "🗽", 95, "rare", False),
        ("Pyramids of Giza Model", "Golden stone pyramids standing proud against desert sands and sunset.", "🐫", 120, "rare", False),
        ("Alpine Ski Goggles", "Reflective mirrored goggles reflecting snowy peaks and alpine trails.", "⛷️", 70, "rare", False),
        ("Tropical Hammock Palms", "A woven hammock strung between two coconut palms over turquoise water.", "🏝️", 85, "rare", False),
        ("Backpacker Rucksack", "A rugged canvas hiking pack equipped with sleeping mat and trekking poles.", "🎒", 50, "common", False),
        ("Vintage Leather Suitcase", "A weathered brown leather trunk covered in historic hotel luggage labels.", "🧳", 65, "common", False),
        ("Brass Nautical Compass", "A gimballed brass compass guiding explorers across uncharted ocean expanses.", "🧭", 55, "common", False),
        ("Mount Everest Summit Flag", "A weathered prayer flag fluttering at the highest rooftop of the world.", "🚩", 250, "epic", True),
        ("Venice Gondola Miniature", "A handcrafted black gondola with silver ferro prow and striped mooring pole.", "🛶", 75, "rare", False),
        ("Safari Rover Jeep", "An open-top expedition rover ready for exploring the vast Serengeti plains.", "🚙", 130, "rare", False),
        ("Grand Canyon Sunset", "A panoramic landscape of red sandstone canyons bathed in golden evening light.", "🏜️", 100, "rare", False),
        ("Colosseum Arena Token", "A miniature roman amphitheater celebrating the grandeur of ancient gladiators.", "🏟️", 85, "rare", False),
        ("Polar Northern Lights", "Shimmering emerald and violet auroral ribbons dancing across arctic skies.", "🌌", 210, "epic", True),
        ("Old World Globe", "A desktop parchment globe on a mahogany stand spinning tales of discovery.", "🌍", 60, "common", False),
        ("Tokyo Neon Skyline", "A vibrant nightscape of Shibuya crossing ablaze with futuristic neon signs.", "🏙️", 115, "rare", True),
        ("Route 66 Road Sign", "A vintage steel highway marker celebrating the legendary American road trip.", "🛣️", 45, "common", False),
        ("Great Wall Watchtower", "A stone garrison standing watch over ancient mountain ridgelines in mist.", "🧱", 125, "rare", False),
        ("Santorini White Windmill", "A whitewashed Greek windmill overlooking azure Aegean seas and bougainvillea.", "🇬🇷", 95, "rare", False),
        ("Deep Sea Scuba Tank", "High-pressure diving gear prepared for exploring colorful coral reefs.", "🤿", 70, "rare", False),
        ("London Double Decker", "A classic bright red Routemaster bus navigating historic city streets.", "🚌", 50, "common", False),
        ("Swiss Mountain Chalet", "A cozy timber cabin with smoke curling from the stone chimney in snow.", "🏡", 160, "rare", False),
        ("Machu Picchu Citadel", "The enigmatic stone terraces of the Incan cloud city nestled in peaks.", "🦙", 190, "epic", False),
        ("Desert Camel Caravan", "Silhouetted camels marching patiently across rippling desert dunes.", "🐪", 80, "rare", False),
        ("Sydney Opera Sails", "The dramatic architectural white shell pavilions over sparkling Sydney harbor.", "⛵", 135, "rare", False),
        ("Bamboo Forest Pathway", "A peaceful walking path through towering green bamboo stalks in Kyoto.", "🎍", 75, "rare", False),
        ("Icelandic Geyser Blast", "A powerful column of boiling geothermal water exploding toward blue sky.", "🌋", 105, "rare", True),
        ("Golden Ticket to Anywhere", "A magical parchment boarding pass valid for any destination on earth.", "🎫", 350, "epic", True),
        ("Space Station Orbit View", "Looking down upon the blue sphere of Earth from the cupola window.", "🛰️", 400, "epic", True),
        ("Seven Wonders Medallion", "A heavy gold medallion bearing reliefs of all seven classical monuments.", "🏅", 650, "legendary", True),
        ("The Explorer's Astrolabe", "The legendary brass astronomical device that unlocked the age of navigation.", "🔭", 1100, "mythic", True)
    ],

    # 13. Funny & Memes (30)
    "funny-memes": [
        ("Tears of Joy Laugh", "A face laughing so hard it is shedding giant streaming blue tears.", "😂", 15, "common", True),
        ("This Is Fine Coffee Dog", "A courageous little dog sipping coffee peacefully while the room is on fire.", "☕", 40, "common", True),
        ("Mind Blown Explosion", "A head popping open with cosmic sparks and swirling colorful galaxies.", "🤯", 35, "common", True),
        ("Rolling on the Floor Laugh", "Laughing uncontrollably while rolling over and kicking your feet.", "🤣", 20, "common", False),
        ("Clown Makeup Kit", "A cosmetic compact and red sponge nose for moments when you played yourself.", "🤡", 25, "common", False),
        ("Deal With It Sunglasses", "Black pixelated shades descending from the ceiling onto cool faces.", "🕶️", 50, "rare", True),
        ("Suspicious Side Eye", "A dramatic glance sideways that speaks a thousand unspoken thoughts.", "👀", 20, "common", False),
        ("Dumpster Fire Trophy", "A miniature metal trash bin cheerfully ablaze with bright orange flames.", "🗑️", 65, "common", True),
        ("Golden Banana Peel", "A slip-hazard banana peel cast in polished brass for glorious fails.", "🍌", 30, "common", False),
        ("Facepalm of Resignation", "A palm slapped firmly against forehead in disbelief at what just occurred.", "🤦", 20, "common", False),
        ("Drama Popcorn Bucket", "A massive striped tub of popcorn ready for watching online arguments unfold.", "🍿", 25, "common", False),
        ("Dramatic Gasp Cat", "A wide-eyed kitten holding its paws to its mouth in absolute shock.", "🙀", 30, "common", False),
        ("Screaming Goat Toy", "A rubber goat figurine that unleashes a high-pitched scream when squeezed.", "🐐", 35, "common", True),
        ("No Thoughts Head Empty", "A cheerful blank cartoon stare with a gentle breeze blowing through.", "🫥", 20, "common", False),
        ("Galaxy Brain Awakening", "A translucent skull radiating brilliant blue beams of supreme realization.", "🧠", 75, "rare", True),
        ("Confused Math Lady", "Puzzled face surrounded by floating geometry formulas and question marks.", "📐", 35, "common", False),
        ("Sad Violin Serenade", "The world's smallest violin playing a mournful solo for tiny problems.", "🎻", 45, "common", False),
        ("Keyboard Rage Smash", "A cartoon fist crashing down on a keyboard sending keys flying everywhere.", "⌨️", 40, "common", True),
        ("Emotional Damage Hammer", "A comically oversized foam mallet labeled 'CRITICAL EMOTIONAL DAMAGE'.", "🔨", 55, "common", False),
        ("Spilled Tea Kettle", "A porcelain teapot tipped over spilling all the hot juicy gossip.", "🫖", 30, "common", False),
        ("Doge Wow Coin", "Much coin. Very crypto. So shine. Wow.", "🪙", 80, "rare", True),
        ("Trash Can Throne", "A gilded throne assembled entirely from recycled cans and plastic bags.", "👑", 60, "common", False),
        ("Mic Drop Moment", "A microphone tumbling downward in slow motion after delivering a savage truth.", "🎤", 50, "common", True),
        ("Salt Bae Seasoning", "Gently flicking coarse salt grains off the elbow with theatrical flair.", "🧂", 40, "common", False),
        ("Shrug of Total Confusion", "Shoulders raised, hands out: 'Nobody knows, and frankly nobody cares.'", "🤷", 20, "common", False),
        ("Pepe Feels Good Frog", "The legendary amphibious face of internet subculture smiling with peace.", "🐸", 90, "rare", False),
        ("Chad Jawline Bust", "A chiselled marble portrait of the stoic internet alpha who fears nothing.", "🗿", 120, "rare", True),
        ("Certified Certified Bruh", "An official wax-stamped certificate verifying that was indeed a bruh moment.", "📜", 45, "common", False),
        ("Golden Toilet Plunger", "An 18k solid gold plunger for dealing with life's absolute biggest messes.", "🪠", 190, "epic", True),
        ("The Supreme Lord of Memes", "A cosmic crown worn by the architect of viral internet immortality.", "👑", 888, "legendary", True)
    ],

    # 14. Special Occasions (40)
    "special-occasions": [
        ("Graduation Cap & Diploma", "A mortarboard cap with golden tassel and ribboned university parchment.", "🎓", 60, "common", False),
        ("Wedding Bells Harmony", "Two silver church bells ringing joyously draped with white silk ribbons.", "🔔", 80, "rare", False),
        ("New Home Welcome Mat", "A cheerful coconut fiber doormat reading 'Home Sweet Home' with keys.", "🔑", 45, "common", False),
        ("Baby Shower Booties", "A tiny pair of hand-knit pastel blue and pink woolen baby shoes.", "👶", 40, "common", False),
        ("Job Promotion Crown", "A golden laurel wreath celebrating ascending to executive leadership.", "💼", 110, "rare", False),
        ("Retirement Beach Chair", "A colorful striped lounger on the beach marking decades of hard work.", "🏖️", 75, "rare", False),
        ("Anniversary Silver Plate", "An engraved sterling silver platter commemorating years of devoted union.", "🍽️", 120, "rare", False),
        ("Golden Anniversary 50th", "A sparkling 50th anniversary crystal obelisk trimmed in pure gold.", "🏆", 250, "epic", True),
        ("Baby Stork Delivery", "A gentle flying white stork carrying a precious bundle in a soft cloth.", "🪿", 70, "rare", False),
        ("Housewarming Orchid", "An elegant white phalaenopsis orchid planted in a modern ceramic pot.", "🪴", 50, "common", False),
        ("Driver's License Keys", "A shiny new car key fob celebrating independence on the open road.", "🗝️", 35, "common", False),
        ("Engagement Sparkler", "A ring box surrounded by glowing fairy lights for the magic question.", "💍", 180, "rare", True),
        ("Bon Voyage Suitcase", "A retro hardcase trunk packed with excitement for moving across oceans.", "✈️", 65, "common", False),
        ("Teacher Appreciation Apple", "A polished crystal apple inscribed with gratitude for inspiring minds.", "🍎", 30, "common", False),
        ("Doctor's White Coat Pin", "A medical caduceus pin honoring compassionate healing and tireless care.", "🩺", 85, "rare", False),
        ("New Pet Collar Tag", "A shiny bone-shaped brass tag engraved with a new family member's name.", "🏷️", 25, "common", False),
        ("Champion Ring of Victory", "A heavyweight ring studded with synthetic rubies celebrating championship.", "💍", 140, "rare", False),
        ("Golden Handshake Token", "Two hands clasping in mutual respect and successful deal completion.", "🤝", 55, "common", False),
        ("Mother's Day Heart Flower", "A bouquet of pastel carnations with a card that reads 'Best Mom Ever'.", "🌸", 40, "common", False),
        ("Father's Day Vintage Watch", "A classic steel chronograph watch celebrating steady guidance.", "⌚", 95, "rare", False),
        ("Grandparents Love Quilt", "A colorful patchwork quilt embroidered with generations of family names.", "🧵", 70, "rare", False),
        ("Newborn Baby Rattle", "A sterling silver heirloom rattle that chimes with gentle tinkling sounds.", "🪇", 50, "common", False),
        ("First Home Golden Key", "A ceremonial giant key unlocking the front door to a new life chapter.", "🗝️", 65, "common", False),
        ("Corporate Milestone Award", "A heavy glass prism etched with corporate achievement recognition.", "🏢", 130, "rare", False),
        ("Olympic Laurel Wreath", "A headband of gilded olive branches honoring supreme athletic dedication.", "🌿", 200, "epic", True),
        ("Silver Wedding 25th Token", "A polished silver medallion celebrating a quarter century of love.", "🥈", 160, "rare", False),
        ("Ruby Anniversary 40th", "A cluster of brilliant pigeon-blood rubies marking four shared decades.", "❤️", 220, "epic", False),
        ("Diamond Jubilee Emblem", "A royal platinum crest marking sixty years of steadfast commitment.", "💎", 320, "epic", True),
        ("Sweet Sixteen Tiara", "A sparkling rhinestone tiara celebrating a milestone coming of age.", "👑", 80, "rare", False),
        ("Bar Mitzvah Tallit Pin", "A silver Star of David pin celebrating entering adult community life.", "✡️", 75, "rare", False),
        ("Quinceañera Rose Scepter", "An ornate silver wand tipped with a pink porcelain rose for celebration.", "🪄", 115, "rare", False),
        ("Eagle Scout Badge", "A prestigious medal honoring exceptional scout leadership and service.", "🦅", 90, "rare", False),
        ("Debutante White Rose", "An immaculate long-stem white rose presented at the formal grand ball.", "🌹", 45, "common", False),
        ("Honorary Doctorate Scroll", "A ribbon-tied parchment conferring highest honors upon an esteemed thinker.", "📜", 150, "rare", False),
        ("Citizenship Oath Torch", "A bronze miniature torch celebrating swearing the oath of a new homeland.", "🗽", 100, "rare", False),
        ("Grammy Golden Gramophone", "A gold-plated replica horn gramophone celebrating artistic creation.", "🎺", 280, "epic", True),
        ("Oscar Academy Statuette", "A gilded knight holding a crusader sword standing on a reel of film.", "🏆", 350, "epic", True),
        ("Nobel Prize Gold Medal", "A heavy gold medallion engraved with Alfred Nobel's profile for peace.", "🥇", 500, "epic", True),
        ("Hall of Fame Induction Plaque", "A bronze bas-relief tablet permanently enshrining lifetime legends.", "🏛️", 420, "epic", False),
        ("Eternal Milestone Monument", "A soaring granite obelisk commemorating a historic breakthrough forever.", "🗿", 1000, "legendary", True)
    ],

    # 15. Seasonal & Limited Edition (40)
    "seasonal-limited": [
        ("Genesis Founder Crown", "The mythical number one crown forged during the genesis block of Chatty.", "👑", 999, "legendary", True),
        ("Crystalline Snowflake", "A six-pointed frost snowflake with laser-etched mathematical symmetry.", "❄️", 40, "common", True),
        ("Summer Beach Umbrella", "A vintage yellow-and-white striped sun parasol fluttering in ocean breezes.", "⛱️", 35, "common", False),
        ("Autumn Amber Leaf", "A translucent amber teardrop preserving a perfect fiery autumn maple leaf.", "🍁", 30, "common", False),
        ("Spring Robin Nest", "A woven twig nest cradling three immaculate robin-egg-blue eggs of new life.", "🪺", 45, "common", False),
        ("Midnight Sun Eclipse", "A celestial event where the moon's dark silhouette glows with golden corona.", "🌑", 320, "epic", True),
        ("Winter Icicle Chandelier", "A chandelier sculpted of natural hanging icicles sparkling with cold light.", "💡", 160, "rare", False),
        ("Solstice Bonfire Blaze", "A towering midnight bonfire celebrating the longest day of the year.", "🔥", 95, "rare", True),
        ("Spring Rain Rainbow", "A vibrant spectral arch connecting green hills after a refreshing shower.", "🌈", 70, "rare", True),
        ("Harvest Full Moon", "A massive orange harvest moon hanging low over misty autumn cornfields.", "🌕", 110, "rare", False),
        ("Golden Infinity Cube", "A mechanical hyper-dimensional puzzle cube that shifts between realities.", "🧊", 450, "epic", True),
        ("Cyber Neon Katana", "A composite alloy blade that glows with an edge of pure ionizing laser energy.", "🗡️", 650, "legendary", True),
        ("Diamond Rain Hourglass", "An hourglass wherein tiny sparkling micro-diamonds fall instead of sand.", "⏳", 380, "epic", True),
        ("Frost Dragon Talon", "A fossilized talon of the glacial frost drake that freezes air around it.", "🪝", 280, "rare", False),
        ("Solar Flare Core", "A magnetic containment sphere holding a churning fragment of stellar plasma.", "☀️", 520, "epic", True),
        ("Spring Swallow Tail", "A migrating swallow soaring back to north skies bringing warmth and spring.", "🐦", 50, "common", False),
        ("Summer Coconut Palm", "A wind-swept palm tree leaning gracefully over turquoise lagoon shallows.", "🌴", 40, "common", False),
        ("Autumn Pumpkin Spice", "A warm ceramic mug of spiced pumpkin latte dusted with cinnamon nutmeg.", "☕", 25, "common", False),
        ("Winter Frost Pine", "A highland spruce bowed gently beneath the weight of fresh powdery snow.", "🌲", 35, "common", False),
        ("Cherry Blossom Petal Storm", "A sudden swirl of thousands of pale pink sakura petals dancing on wind.", "🌸", 85, "rare", True),
        ("Equinox Balance Scale", "A silver celestial scale balancing equal measures of daylight and darkness.", "⚖️", 130, "rare", False),
        ("Thunderstorm Lightning Bolt", "A jagged fork of purple electrical energy captured inside a crystal tube.", "⚡", 200, "epic", True),
        ("Monsoon Water Lily Pond", "A stone reflection pool rippling with heavy drops of fragrant rain.", "🌧️", 60, "common", False),
        ("Aurora Borealis Orb", "A hand-blown glass orb swirling with real polar geomagnetic lights.", "🔮", 260, "epic", True),
        ("Meteor Shower Fragment", "A pitted chondrite meteorite cool to the touch from the depths of space.", "☄️", 310, "epic", True),
        ("Desert Mirage Oasis", "An ethereal shimmering vision of palm trees and water in baking heat.", "🏜️", 90, "rare", False),
        ("Midnight Bioluminescent Wave", "A breaking ocean wave glowing with turquoise neon sea plankton.", "🌊", 175, "rare", True),
        ("Black Ice Rose", "A flower formed entirely of razor-sharp transparent obsidian glass ice.", "🥀", 240, "rare", False),
        ("Golden Autumn Acorn", "An oak acorn cast in 24k gold symbolizing immense future potential.", "🌰", 55, "common", False),
        ("Holographic Butterfly", "A digital butterfly whose wings shift through holographic spectrums.", "🦋", 140, "rare", True),
        ("Winter Solstice Yule Star", "The brightest guiding star shining above the snowy northern horizon.", "⭐", 190, "rare", True),
        ("Cybernetic Angel Wings", "A pair of mechanical wings made of lightweight carbon fiber and white LEDs.", "🪽", 750, "legendary", True),
        ("Chronos Time Crystal", "A four-dimensional crystal vibrating with the pulse of the cosmic clock.", "💎", 850, "legendary", True),
        ("Nebula in a Bottle", "A glass flask holding a miniature swirling purple and blue stellar nebula.", "🧪", 600, "epic", True),
        ("Prismatic Void Shard", "A crystal fragment pulled from the boundary between space and the void.", "✨", 920, "legendary", True),
        ("The Phoenix Resurrection Egg", "An egg that periodically bursts into cool flame and re-emerges pristine.", "🥚", 1100, "legendary", True),
        ("Solaris Sovereign Blade", "A broadsword forged inside the corona of a young star that burns evil.", "⚔️", 1350, "mythic", True),
        ("The Eternal Chatty Relic", "A sacred digital artifact commemorating the triumph of connection.", "🏛️", 1800, "mythic", True),
        ("Celestial Genesis Halo", "A floating ring of pure divine white light worn by universe guardians.", "😇", 2400, "mythic", True),
        ("The Alpha & Omega Keystone", "The cornerstone of reality itself, radiating all colors simultaneously.", "🌌", 3000, "mythic", True)
    ]
}

def main():
    print("==================================================")
    print("CHATTY 600 UNIQUE GIFTS (15 CATEGORIES) BUILDER")
    print("==================================================")

    total_defined = sum(len(items) for items in CAT_ITEMS.values())
    print(f"Total defined items across 15 categories: {total_defined}")
    assert total_defined == 600, f"Expected 600 items, got {total_defined}"

    for cat in CATEGORIES:
        cid = cat["id"]
        cname = cat["name"]
        target = cat["target"]
        actual = len(CAT_ITEMS.get(cid, []))
        print(f"  - [{cid}] {cname}: {actual} items (Target: {target})")
        assert actual == target, f"Category {cid} count mismatch: expected {target}, got {actual}"

    os.makedirs(SERVER_PUBLIC_ASSETS, exist_ok=True)
    os.makedirs(CLIENT_PUBLIC_ASSETS, exist_ok=True)
    os.makedirs(SERVER_DATA_DIR, exist_ok=True)
    os.makedirs(CLIENT_GIFT_DIR, exist_ok=True)

    for cat in CATEGORIES:
        os.makedirs(os.path.join(SERVER_PUBLIC_ASSETS, cat["folder"]), exist_ok=True)
        os.makedirs(os.path.join(CLIENT_PUBLIC_ASSETS, cat["folder"]), exist_ok=True)

    full_catalog = []
    seen_ids = set()
    seen_slugs = set()
    seen_names = set()

    for cat in CATEGORIES:
        cid = cat["id"]
        cname = cat["name"]
        cfolder = cat["folder"]
        items = CAT_ITEMS[cid]

        for idx, item in enumerate(items):
            name, desc, icon, price, rarity, is_animated = item
            slug = slugify(name)
            gid = f"gift_{cid}_{idx+1:02d}"

            assert gid not in seen_ids, f"Duplicate ID: {gid}"
            assert slug not in seen_slugs, f"Duplicate Slug: {slug} (Name: {name})"
            assert name not in seen_names, f"Duplicate Name: {name}"
            seen_ids.add(gid)
            seen_slugs.add(slug)
            seen_names.add(name)

            svg_code = generate_svg(name, icon, cid, cat["gradient"], cat["accent"], rarity, idx)
            server_svg_path = os.path.join(SERVER_PUBLIC_ASSETS, cfolder, f"{slug}.svg")
            client_svg_path = os.path.join(CLIENT_PUBLIC_ASSETS, cfolder, f"{slug}.svg")

            with open(server_svg_path, "w", encoding="utf-8") as f:
                f.write(svg_code)
            with open(client_svg_path, "w", encoding="utf-8") as f:
                f.write(svg_code)

            image_rel_path = f"/assets/gifts/{cfolder}/{slug}.svg"

            badge_text = ""
            if rarity == "legendary": badge_text = "👑 LEGENDARY"
            elif rarity == "mythic": badge_text = "🌟 MYTHIC"
            elif rarity == "epic": badge_text = "💎 EPIC"
            elif rarity == "rare": badge_text = "✨ RARE"

            gift_doc = {
                "id": gid,
                "name": name,
                "slug": slug,
                "description": desc,
                "category": cname,
                "subcategory": cid,
                "tags": [cid, slug.replace("-", " "), rarity, name.lower()],
                "coinPrice": price,
                "icon": icon,
                "image": image_rel_path,
                "thumbnail": image_rel_path,
                "animationAsset": f"anim_{slug}" if is_animated else "",
                "assetType": "svg",
                "isAnimated": is_animated,
                "isPremium": price >= 200 or rarity in ["epic", "legendary", "mythic"],
                "isPopular": (idx % 3 == 0) or price < 50,
                "isTrending": (idx % 4 == 0) or rarity == "legendary",
                "isLimitedEdition": cid == "seasonal-limited" or idx >= len(items) - 5,
                "isNew": idx >= len(items) - 8,
                "isActive": True,
                "displayOrder": idx + 1,
                "rarity": rarity,
                "gradient": cat["gradient"],
                "badge": badge_text,
                "color": cat["accent"]
            }
            full_catalog.append(gift_doc)

    print(f"\nSuccessfully generated {len(full_catalog)} catalog entries and SVGs on disk.")

    server_json_path = os.path.join(SERVER_DATA_DIR, "gifts-catalog.json")
    with open(server_json_path, "w", encoding="utf-8") as f:
        json.dump(full_catalog, f, indent=2)

    server_js_path = os.path.join(SERVER_DATA_DIR, "gifts-catalog.data.js")
    with open(server_js_path, "w", encoding="utf-8") as f:
        f.write("/**\n * Autogenerated Gift Catalog Data (600 Unique Gifts Across 15 Categories)\n */\n\n")
        f.write(f"export const GIFT_CATEGORIES = {json.dumps(CATEGORIES, indent=2)};\n\n")
        f.write(f"export const GIFTS_CATALOG = {json.dumps(full_catalog, indent=2)};\n\n")
        f.write("export default GIFTS_CATALOG;\n")

    client_js_path = os.path.join(CLIENT_GIFT_DIR, "giftData.js")
    with open(client_js_path, "w", encoding="utf-8") as f:
        f.write("/**\n * Client Gift Data (600 Unique Gifts Across 15 Categories)\n */\n\n")
        f.write(f"export const GIFT_CATEGORIES = {json.dumps(CATEGORIES, indent=2)};\n\n")
        f.write(f"export const GIFTS_CATALOG = {json.dumps(full_catalog, indent=2)};\n\n")
        f.write("export default GIFTS_CATALOG;\n")

    print(f"Saved server JSON catalog to: {server_json_path}")
    print(f"Saved server JS data to: {server_js_path}")
    print(f"Saved client JS data to: {client_js_path}")
    print("Catalog generation complete!")

if __name__ == "__main__":
    main()
