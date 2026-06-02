"""Add status and error_message columns to knowledge_bases table."""

from sqlalchemy import create_engine, text


def run_migration(db_url: str = "sqlite:///data/basjoo.db"):
    engine = create_engine(db_url)
    with engine.connect() as conn:
        conn.execute(
            text(
                "ALTER TABLE knowledge_bases "
                "ADD COLUMN status VARCHAR(20) DEFAULT 'active' NOT NULL"
            )
        )
        conn.execute(text("ALTER TABLE knowledge_bases ADD COLUMN error_message TEXT"))
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_knowledge_bases_status "
                "ON knowledge_bases(status)"
            )
        )
        conn.commit()
    print("Migration add_kb_status_error completed")


if __name__ == "__main__":
    run_migration()
