SKILL_ALIASES = {
    "python": ["python", "python3"],
    "react": ["react", "reactjs", "react.js"],
    "nodejs": ["node", "nodejs", "node.js"],
    "javascript": ["js", "javascript"],
    "typescript": ["ts", "typescript"],
    "machine_learning": ["ml", "machine learning", "deep learning"],
    "kubernetes": ["k8s", "kubernetes"],
    "postgresql": ["postgres", "postgresql", "psql"],
    "mongodb": ["mongo", "mongodb"],
    "docker": ["docker", "containers"],
    "aws": ["aws", "amazon web services"],
    "fastapi": ["fastapi"],
    "nextjs": ["next", "nextjs", "next.js"],
    "langchain": ["langchain"],
    "pytorch": ["pytorch", "torch"],
    "tensorflow": ["tensorflow", "tf"],
    "rag": ["rag", "retrieval augmented generation"],
    "scikit_learn": ["scikit-learn", "sklearn", "scikit learn"],
    "computer_vision": ["opencv", "computer vision", "cv"],
    "ci_cd": [
        "ci/cd", "ci-cd", "cicd", "ci cd", "ci/cd pipelines", "cicd pipelines",
        "continuous integration", "continuous deployment",
    ],
    "rest_api": ["rest api", "rest apis", "restful", "restful api", "restful apis"],
    "power_bi": ["power bi", "powerbi", "power-bi"],
    "tcp_ip": ["tcp/ip", "tcp-ip", "tcp ip"],
    "xgboost": ["xgboost", "xgb"],
    "random_forest": ["random forest", "randomforest"],
    "sql": ["sql", "structured query language"],
    "nlp": ["nlp", "natural language processing"],
    "generative_ai": ["generative ai", "genai", "gen ai"],
    "azure": ["azure", "microsoft azure"],
    "gcp": ["gcp", "google cloud platform", "google cloud"],
    "sre": ["sre", "site reliability engineering", "site reliability engineer"],
}

_ALIAS_LOOKUP = {alias: canonical for canonical, aliases in SKILL_ALIASES.items() for alias in aliases}


def normalize_skill(skill: str) -> str:
    cleaned = skill.lower().strip()
    return _ALIAS_LOOKUP.get(cleaned, cleaned)
