from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import String, Boolean, Float, ForeignKey, Table, Column, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

db = SQLAlchemy()

# ── Association table for event participants ─────────────
event_participants = Table(
    "event_participants",
    db.metadata,
    Column("event_id", ForeignKey("event.id"), primary_key=True),
    Column("user_id",  ForeignKey("user.id"),  primary_key=True),
)

# ── USER ─────────────────────────────────────────────────
class User(db.Model):
    __tablename__ = "user"

    id:        Mapped[int]  = mapped_column(primary_key=True)
    email:     Mapped[str]  = mapped_column(String(120), unique=True, nullable=False)
    password:  Mapped[str]  = mapped_column(nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean(), nullable=False)

    def serialize(self):
        return {
            "id": self.id,
            "email": self.email,
        }

# ── EVENT ─────────────────────────────────────────────────
class Event(db.Model):
    __tablename__ = "event"

    id:         Mapped[int]   = mapped_column(primary_key=True)
    date:       Mapped[str]   = mapped_column(String(50),  nullable=False)
    time:       Mapped[str]   = mapped_column(String(50),  nullable=False)
    location:   Mapped[str]   = mapped_column(String(255), nullable=False)
    latitude:   Mapped[float] = mapped_column(Float,       nullable=True)
    longitude:  Mapped[float] = mapped_column(Float,       nullable=True)
    details:    Mapped[str]   = mapped_column(Text,        nullable=True)
    image:      Mapped[str]   = mapped_column(String(500), nullable=True)
    creator_id: Mapped[int]   = mapped_column(ForeignKey("user.id"), nullable=False)

    creator:      Mapped["User"]       = relationship("User", foreign_keys=[creator_id])
    participants: Mapped[list["User"]] = relationship(
        "User", secondary=event_participants, lazy="selectin"
    )

    def serialize(self):
        return {
            "id":                 self.id,
            "date":               self.date,
            "time":               self.time,
            "location":           self.location,
            "latitude":           self.latitude,
            "longitude":          self.longitude,
            "details":            self.details,
            "image":              self.image,
            "creator_id":         self.creator_id,
            "creator_email":      self.creator.email,
            "participants":       [{"id": p.id, "email": p.email} for p in self.participants],
            "participants_count": len(self.participants),
        }