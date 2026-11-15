"""
Canonical Labelled Evaluation Dataset from AGENT.md Section 7.
Used by management command `evaluate_routing` and automated test suites to measure
precision, recall, false positives, and false negatives.
"""

EVALUATION_SCENARIOS = [
    {
        "id": "scenario_1",
        "author_company": "Swiggy",
        "title": "Diwali Delivery Discount",
        "content": "5% off all deliveries above 300 rupees during Diwali week.",
        "expected_recipients": ["PhonePe", "HDFC Bank"],
        "unexpected_recipients": ["Bajaj Auto"],
        "borderline_recipients": ["Flipkart"],
        "description": "Diwali food delivery promotion. Should reach payments and card banking partners, not automotive.",
    },
    {
        "id": "scenario_2",
        "author_company": "Flipkart",
        "title": "Big Billion Days Sale",
        "content": "Big Billion Days electronics sale with 10% instant discount on card payments.",
        "expected_recipients": ["HDFC Bank", "PhonePe"],
        "unexpected_recipients": ["Bajaj Auto"],
        "borderline_recipients": [],
        "description": "Festive e-commerce shopping festival with card discounts. Should route to banking and payment processors.",
    },
    {
        "id": "scenario_3",
        "author_company": "Bajaj Auto",
        "title": "Festive Scooter Launch",
        "content": "New scooter launch with zero-down-payment financing this festive season.",
        "expected_recipients": ["HDFC Bank"],
        "unexpected_recipients": ["Swiggy", "Flipkart", "PhonePe"],
        "borderline_recipients": [],
        "description": "Automotive two-wheeler financing launch. Should route to loan/banking partner only.",
    },
    {
        "id": "scenario_4",
        "author_company": "PhonePe",
        "title": "Merchant UPI Cashback",
        "content": "UPI cashback of 20 rupees on first merchant payment.",
        "expected_recipients": ["Swiggy", "Flipkart", "HDFC Bank"],
        "unexpected_recipients": ["Bajaj Auto"],
        "borderline_recipients": [],
        "description": "Merchant payment cashback promotion. Relevant to online food and retail merchants and banking partners.",
    },
    {
        "id": "scenario_5",
        "author_company": "HDFC Bank",
        "title": "Festive EMI Consumer Offer",
        "content": "Festive EMI offer on consumer purchases above 10,000 rupees.",
        "expected_recipients": ["Flipkart", "PhonePe"],
        "unexpected_recipients": ["Bajaj Auto", "Swiggy"],
        "borderline_recipients": [],
        "description": "High-ticket consumer EMI retail financing. Relevant to retail shopping and checkout gateways.",
    },
]
