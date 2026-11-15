from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
from api.models import Agent, AgentInterest, UserAgentAccess

User = get_user_model()

SEED_AGENTS = [
    {
        "company_name": "Swiggy",
        "industry_category": "Food Delivery & Quick Commerce",
        "description": "Leading food ordering, delivery logistics, and quick commerce network in India.",
        "interests": [
            ("food delivery", "Online food ordering, restaurant discovery and hyper-local food delivery."),
            ("restaurant partnerships", "Strategic dining and restaurant chain tie-ups and cloud kitchens."),
            ("festive discounts", "Seasonal promotional offers and holiday delivery price cuts."),
            ("delivery logistics", "Last-mile courier logistics, rider fleet optimization, and speed."),
            ("quick commerce", "10-minute grocery and daily essentials instant delivery."),
        ],
    },
    {
        "company_name": "Flipkart",
        "industry_category": "E-Commerce",
        "description": "Major Indian online retail marketplace covering electronics, fashion, and consumer goods.",
        "interests": [
            ("e-commerce sales", "High-volume online retail shopping sales and flash deals."),
            ("festive shopping events", "Annual Big Billion Days and festive blockbuster discount sales."),
            ("electronics and fashion offers", "Special merchant discounts on consumer tech, smartphones, and apparel."),
            ("seller partnerships", "Direct manufacturer and merchant onboarding programs."),
            ("bank card offers at checkout", "Instant card checkout discounts and payment gateway promotions."),
        ],
    },
    {
        "company_name": "PhonePe",
        "industry_category": "Digital Payments & Fintech",
        "description": "Digital payments and financial technology ecosystem powered by UPI and digital wallets.",
        "interests": [
            ("UPI payments", "Unified Payments Interface instant bank transfers and QR code payments."),
            ("cashback and rewards", "Consumer rewards, scratch cards, and merchant cashback programs."),
            ("merchant payment partnerships", "Online checkout integration with top consumer internet brands."),
            ("wallet and card payment offers", "Co-branded wallet promotions and debit/credit card perks."),
            ("festive payment promotions", "Holiday cashback campaigns and consumer payment bonuses."),
        ],
    },
    {
        "company_name": "HDFC Bank",
        "industry_category": "Banking & Financial Services",
        "description": "Premier private sector bank providing consumer banking, credit cards, and retail lending.",
        "interests": [
            ("credit and debit cards", "Card issuance, interchange, rewards points, and premium cardholder perks."),
            ("EMI and consumer loans", "Easy monthly installment financing and pre-approved personal loans."),
            ("card offers with merchants", "Exclusive cardholder discounts with food, travel, and retail merchants."),
            ("banking partnerships", "Enterprise corporate banking, payroll, and payment settlements."),
            ("festive spending offers", "Annual festive card discounts and low-interest EMI deals."),
        ],
    },
    {
        "company_name": "Bajaj Auto",
        "industry_category": "Automotive & Manufacturing",
        "description": "Leading manufacturer and exporter of motorcycles, commercial vehicles, and electric scooters.",
        "interests": [
            ("motorcycles and scooters", "Two-wheeler personal mobility vehicles, bikes, and e-scooters."),
            ("two-wheeler financing", "Consumer vehicle loan partnerships, low down-payment schemes."),
            ("dealership network", "Authorized service centers, retail showrooms, and parts distribution."),
            ("vehicle launches and service", "New model premieres, test drives, and scheduled vehicle maintenance."),
            ("auto industry news", "Mobility industry trends, emissions regulations, and EV adoption updates."),
        ],
    },
]


class Command(BaseCommand):
    help = "Seeds the five canonical enterprise agents and their interests from AGENT.md Section 7."

    def add_arguments(self, parser):
        parser.add_argument(
            '--reset',
            action='store_true',
            help='Delete existing seeded agents and re-create them with fresh API keys.',
        )

    def handle(self, *args, **options):
        reset = options.get('reset', False)
        if reset:
            self.stdout.write(self.style.WARNING("Resetting existing agents..."))
            Agent.objects.all().delete()

        # Ensure demo user exists
        demo_user, created = User.objects.get_or_create(
            username='demo',
            defaults={'email': 'demo@agentnetwork.internal', 'is_staff': True}
        )
        if created:
            demo_user.set_password('demo123')
            demo_user.save()
            self.stdout.write(self.style.SUCCESS("Created demo user: username='demo', password='demo123'"))

        self.stdout.write(self.style.MIGRATE_HEADING("Seeding Canonical Agents and Interests..."))
        generated_keys = {}

        for item in SEED_AGENTS:
            agent, created = Agent.objects.get_or_create(
                company_name=item["company_name"],
                defaults={
                    "industry_category": item["industry_category"],
                    "description": item["description"],
                    "verification_status": "verified",
                    "is_active": True,
                }
            )

            # Generate new API key if newly created or if reset
            if created or not agent.api_key_hash:
                raw_key, key_hash = Agent.generate_api_key()
                agent.api_key_hash = key_hash
                agent.save(update_fields=['api_key_hash'])
                generated_keys[agent.company_name] = raw_key
            else:
                generated_keys[agent.company_name] = "(unchanged - already hashed in DB)"

            # Ensure demo user has access to act as this agent
            UserAgentAccess.objects.get_or_create(user=demo_user, agent=agent)

            # Seed interests
            for topic, desc in item["interests"]:
                interest, int_created = AgentInterest.objects.get_or_create(
                    agent=agent,
                    topic=topic,
                    defaults={"description": desc, "is_active": True}
                )
                if not int_created and interest.description != desc:
                    interest.description = desc
                    interest.save(update_fields=['description'])

            status_str = "Created" if created else "Updated"
            self.stdout.write(
                self.style.SUCCESS(f"  [+] {status_str} Agent: {agent.company_name} ({len(item['interests'])} interests)")
            )

        self.stdout.write(self.style.SUCCESS("\n--- Canonical Agent API Keys (Keep secure) ---"))
        for name, key in generated_keys.items():
            self.stdout.write(f"  {name:12}: {key}")
        self.stdout.write(self.style.SUCCESS("--------------------------------------------\n"))
        self.stdout.write(self.style.SUCCESS("Seeding complete! 5 agents ready with full UserAgentAccess."))
