"""Initial TIC operational schema and query objects."""
from alembic import op
from src.db.models import Base
from src.db.views import VIEW_SQL, DROP_VIEW_SQL

revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind)
    if bind.dialect.name == "postgresql":
        op.execute(VIEW_SQL)

def downgrade():
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(DROP_VIEW_SQL)
    Base.metadata.drop_all(bind=bind)

