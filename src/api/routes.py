from flask import Blueprint, request, jsonify
from flask_cors import CORS
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity
from werkzeug.security import generate_password_hash, check_password_hash
from api.models import (
    db, User, Event, Friendship, ChatRoom, ChatMessage,
    Notification, ChatRoomMembership,
)
from datetime import datetime, timedelta
api = Blueprint('api', __name__)
CORS(api)


# =========================================================
# NOTIFICATION HELPERS (internal)
# =========================================================
# Wrap notification creation/cleanup so the existing handlers
# stay readable. These helpers never commit on their own — the
# caller commits once at the end of its request.

def _create_notification(user_id, notif_type, payload):
    """Create a notification row. Caller is responsible for db.session.commit()."""
    notif = Notification(
        user_id=user_id,
        type=notif_type,
        payload=payload or {},
        is_read=False,
    )
    db.session.add(notif)
    return notif


def _delete_friend_request_notifications(friendship_id):
    """Drop every notification that references a given friendship row."""
    notifs = Notification.query.filter_by(type="friend_request").all()
    for n in notifs:
        if (n.payload or {}).get("friendship_id") == friendship_id:
            db.session.delete(n)


def _mark_friend_request_notifications_read(friendship_id):
    notifs = Notification.query.filter_by(type="friend_request").all()
    for n in notifs:
        if (n.payload or {}).get("friendship_id") == friendship_id:
            n.is_read = True


def _delete_event_invite_notifications(event_id, user_id=None):
    """
    Drop event_invite notifications for an event.
    If user_id is given, only drops that user's notification.
    """
    q = Notification.query.filter_by(type="event_invite")
    if user_id is not None:
        q = q.filter_by(user_id=user_id)
    for n in q.all():
        if (n.payload or {}).get("event_id") == event_id:
            db.session.delete(n)


def _get_or_create_membership(room_id, user_id):
    m = ChatRoomMembership.query.filter_by(room_id=room_id, user_id=user_id).first()
    if not m:
        m = ChatRoomMembership(room_id=room_id, user_id=user_id, last_read_at=None)
        db.session.add(m)
    return m


# =========================================================
# HELLO
# =========================================================

@api.route('/hello', methods=['GET'])
def handle_hello():
    return jsonify({"message": "Hello! I'm a message that came from the backend"}), 200


# =========================================================
# REGISTER
# =========================================================

@api.route('/register', methods=['GET', 'POST'])
def register():

    if request.method == "GET":
        return jsonify({
            "endpoint": "/api/register",
            "method": "POST",
            "body": {"email": "test@test.com", "password": "123456"}
        }), 200

    body = request.get_json() or {}
    email = body.get("email")
    password = body.get("password")

    if not email or not password:
        return jsonify({"msg": "Email and password are required"}), 400

    if User.query.filter_by(email=email).first():
        return jsonify({"msg": "User already exists"}), 400

    new_user = User(
        email=email,
        password=generate_password_hash(password),
        is_active=True
    )
    db.session.add(new_user)
    db.session.commit()

    return jsonify({"msg": "User registered successfully", "user": new_user.serialize()}), 201


# =========================================================
# LOGIN
# =========================================================

@api.route('/login', methods=['GET', 'POST'])
def login():

    if request.method == "GET":
        return jsonify({
            "endpoint": "/api/login",
            "method": "POST",
            "body": {"email": "test@test.com", "password": "123456"}
        }), 200

    body = request.get_json() or {}
    email = body.get("email")
    password = body.get("password")

    if not email or not password:
        return jsonify({"msg": "Email and password are required"}), 400

    user = User.query.filter_by(email=email).first()

    if not user or not check_password_hash(user.password, password):
        return jsonify({"msg": "Invalid email or password"}), 401

    access_token = create_access_token(identity=str(user.id))

    return jsonify({"token": access_token, "user": user.serialize()}), 200


# =========================================================
# PRIVATE
# =========================================================

@api.route('/private', methods=['GET'])
@jwt_required()
def private():
    user = User.query.get(get_jwt_identity())
    if not user:
        return jsonify({"msg": "User not found"}), 404
    return jsonify({"msg": "Private route accessed", "user": user.serialize()}), 200


# =========================================================
# EVENTS
# =========================================================

@api.route('/events', methods=['POST'])
@jwt_required()
def create_event():
    current_user_id = int(get_jwt_identity())
    body = request.get_json() or {}

    required = ["date", "time", "location"]
    if not all(body.get(f) for f in required):
        return jsonify({"msg": "date, time and location are required"}), 400

    creator = db.session.get(User, current_user_id)

    event = Event(
        title=body.get("title"),
        date=body["date"],
        time=body["time"],
        location=body["location"],
        latitude=body.get("latitude"),
        longitude=body.get("longitude"),
        details=body.get("details"),
        image=body.get("image"),
        creator_id=current_user_id
    )

    # add creator as participant automatically
    event.participants.append(creator)

    # add invited friends
    invited_users = []
    for friend_id in body.get("invitedFriends", []):
        friend = db.session.get(User, friend_id)
        if friend and friend.id != current_user_id:
            event.participants.append(friend)
            invited_users.append(friend)

    db.session.add(event)
    db.session.flush()  # need event.id before creating the chat room

    # auto-create the chat room for this event
    room = ChatRoom(event_id=event.id)
    db.session.add(room)

    # one notification per invited friend
    for friend in invited_users:
        _create_notification(
            user_id=friend.id,
            notif_type="event_invite",
            payload={
                "event_id":    event.id,
                "from_user_id": current_user_id,
                "from_email":  creator.email,
                "event_title": event.title,
                "event_date":  event.date,
                "event_time":  event.time,
            },
        )

    db.session.commit()

    return jsonify({"msg": "Event created", "event": event.serialize()}), 201


@api.route('/events', methods=['GET'])
@jwt_required()
def get_events():
    current_user_id = int(get_jwt_identity())

    # returns events where the user is creator OR was invited
    all_events = Event.query.all()
    visible = [
        e for e in all_events
        if e.creator_id == current_user_id
        or current_user_id in [p.id for p in e.participants]
    ]

    return jsonify([e.serialize() for e in visible]), 200

# =========================================================
# EVENT MANAGEMENT (single event, update, invite, remove)
# =========================================================

# ---------- GET SINGLE EVENT ----------
@api.route('/events/<int:event_id>', methods=['GET'])
@jwt_required()
def get_event(event_id):
    current_user_id = int(get_jwt_identity())
    event = db.session.get(Event, event_id)
    if not event:
        return jsonify({"msg": "Event not found"}), 404

    is_creator = (event.creator_id == current_user_id)
    is_participant = current_user_id in [p.id for p in event.participants]

    data = event.serialize()
    data["is_creator"]     = is_creator
    data["is_participant"] = is_participant

    # attach chat room id so the client can open the conversation directly
    room = ChatRoom.query.filter_by(event_id=event_id).first()
    data["chat_room_id"] = room.id if room else None

    return jsonify(data), 200


# ---------- UPDATE EVENT (creator only) ----------
@api.route('/events/<int:event_id>', methods=['PUT'])
@jwt_required()
def update_event(event_id):
    current_user_id = int(get_jwt_identity())
    event = db.session.get(Event, event_id)
    if not event:
        return jsonify({"msg": "Event not found"}), 404
    if event.creator_id != current_user_id:
        return jsonify({"msg": "Only the creator can edit this event"}), 403

    body = request.get_json() or {}

    editable = ["title", "date", "time", "location", "latitude", "longitude", "details", "image"]
    for field in editable:
        if field in body:
            setattr(event, field, body[field])

    db.session.commit()
    return jsonify({"msg": "Event updated", "event": event.serialize()}), 200


# ---------- INVITE FRIEND TO EVENT (creator only) ----------
# Body: { "user_id": <int> }
@api.route('/events/<int:event_id>/invite', methods=['POST'])
@jwt_required()
def invite_to_event(event_id):
    current_user_id = int(get_jwt_identity())
    event = db.session.get(Event, event_id)
    if not event:
        return jsonify({"msg": "Event not found"}), 404
    if event.creator_id != current_user_id:
        return jsonify({"msg": "Only the creator can invite people"}), 403

    body = request.get_json() or {}
    target_id = body.get("user_id")
    if not target_id:
        return jsonify({"msg": "user_id is required"}), 400

    target = db.session.get(User, target_id)
    if not target:
        return jsonify({"msg": "User not found"}), 404

    # must be an accepted friend of the creator
    is_friend = Friendship.query.filter(
        Friendship.status == "accepted",
        ((Friendship.requester_id == current_user_id) & (Friendship.addressee_id == target_id)) |
        ((Friendship.requester_id == target_id) & (Friendship.addressee_id == current_user_id))
    ).first()
    if not is_friend:
        return jsonify({"msg": "You can only invite accepted friends"}), 403

    if target_id in [p.id for p in event.participants]:
        return jsonify({"msg": "User is already a participant"}), 409

    event.participants.append(target)

    creator = db.session.get(User, current_user_id)
    _create_notification(
        user_id=target.id,
        notif_type="event_invite",
        payload={
            "event_id":    event.id,
            "from_user_id": current_user_id,
            "from_email":  creator.email,
            "event_title": event.title,
            "event_date":  event.date,
            "event_time":  event.time,
        },
    )

    db.session.commit()
    return jsonify({"msg": "Friend invited", "event": event.serialize()}), 201


# ---------- DELETE EVENT (creator only) ----------
# Supprime l'event + sa ChatRoom + ses ChatMessages (cascade) + notifs liees.
@api.route('/events/<int:event_id>', methods=['DELETE'])
@jwt_required()
def delete_event(event_id):
    current_user_id = int(get_jwt_identity())
    event = db.session.get(Event, event_id)
    if not event:
        return jsonify({"msg": "Event not found"}), 404
    if event.creator_id != current_user_id:
        return jsonify({"msg": "Only the creator can delete this event"}), 403

    # drop every event_invite notification pointing at this event
    _delete_event_invite_notifications(event_id)

    # detach participants (association table) before deleting
    event.participants.clear()

    # delete the ChatRoom (messages + memberships cascade)
    room = ChatRoom.query.filter_by(event_id=event_id).first()
    if room:
        db.session.delete(room)

    db.session.delete(event)
    db.session.commit()
    return jsonify({"msg": "Event deleted"}), 200


# ---------- REMOVE PARTICIPANT ----------
# Rules:
#   - creator can remove anyone except themself
#   - non-creator can only remove themself (leave the event)
@api.route('/events/<int:event_id>/participants/<int:user_id>', methods=['DELETE'])
@jwt_required()
def remove_participant(event_id, user_id):
    current_user_id = int(get_jwt_identity())
    event = db.session.get(Event, event_id)
    if not event:
        return jsonify({"msg": "Event not found"}), 404

    if user_id == event.creator_id:
        return jsonify({"msg": "The creator cannot leave their own event"}), 400

    if current_user_id != event.creator_id and current_user_id != user_id:
        return jsonify({"msg": "Not allowed"}), 403

    target = next((p for p in event.participants if p.id == user_id), None)
    if not target:
        return jsonify({"msg": "User is not a participant"}), 404

    event.participants.remove(target)

    # clean up the invite notification for that user (if any)
    _delete_event_invite_notifications(event_id, user_id=user_id)

    db.session.commit()
    return jsonify({"msg": "Participant removed", "event": event.serialize()}), 200

# =========================================================
# FRIENDS
# =========================================================

# ---------- LIST ACCEPTED FRIENDS ----------
@api.route('/friends', methods=['GET'])
@jwt_required()
def list_friends():
    current_user_id = int(get_jwt_identity())

    friendships = Friendship.query.filter(
        Friendship.status == "accepted",
        (Friendship.requester_id == current_user_id) |
        (Friendship.addressee_id == current_user_id)
    ).all()

    return jsonify([f.serialize(current_user_id=current_user_id) for f in friendships]), 200


# ---------- LIST PENDING REQUESTS ----------
# ?direction=incoming  -> requests sent TO me     (default)
# ?direction=outgoing  -> requests sent BY me
# ?direction=all       -> both
@api.route('/friends/requests', methods=['GET'])
@jwt_required()
def list_friend_requests():
    current_user_id = int(get_jwt_identity())
    direction = request.args.get("direction", "incoming").lower()

    base = Friendship.query.filter(Friendship.status == "pending")

    if direction == "incoming":
        base = base.filter(Friendship.addressee_id == current_user_id)
    elif direction == "outgoing":
        base = base.filter(Friendship.requester_id == current_user_id)
    elif direction == "all":
        base = base.filter(
            (Friendship.requester_id == current_user_id) |
            (Friendship.addressee_id == current_user_id)
        )
    else:
        return jsonify({"msg": "direction must be incoming, outgoing or all"}), 400

    return jsonify([f.serialize(current_user_id=current_user_id) for f in base.all()]), 200


# ---------- SEND A FRIEND REQUEST ----------
# Body: { "user_id": <int> }  OR  { "email": "<str>" }
@api.route('/friends/requests', methods=['POST'])
@jwt_required()
def send_friend_request():
    current_user_id = int(get_jwt_identity())
    body = request.get_json() or {}

    target = None
    if body.get("user_id"):
        target = db.session.get(User, body["user_id"])
    elif body.get("email"):
        target = User.query.filter_by(email=body["email"]).first()

    if not target:
        return jsonify({"msg": "Target user not found"}), 404

    if target.id == current_user_id:
        return jsonify({"msg": "You cannot friend yourself"}), 400

    # look for an existing row in either direction
    existing = Friendship.query.filter(
        ((Friendship.requester_id == current_user_id) & (Friendship.addressee_id == target.id)) |
        ((Friendship.requester_id == target.id) & (Friendship.addressee_id == current_user_id))
    ).first()

    me = db.session.get(User, current_user_id)

    if existing:
        if existing.status == "accepted":
            return jsonify({
                "msg": "You are already friends",
                "friendship": existing.serialize(current_user_id=current_user_id)
            }), 409
        if existing.status == "pending":
            return jsonify({
                "msg": "A request is already pending",
                "friendship": existing.serialize(current_user_id=current_user_id)
            }), 409
        # status == "refused"  ->  allow reopening by resetting to pending
        existing.requester_id = current_user_id
        existing.addressee_id = target.id
        existing.status = "pending"

        _create_notification(
            user_id=target.id,
            notif_type="friend_request",
            payload={
                "friendship_id": existing.id,
                "from_user_id":  current_user_id,
                "from_email":    me.email,
            },
        )

        db.session.commit()
        return jsonify({
            "msg": "Friend request re-sent",
            "friendship": existing.serialize(current_user_id=current_user_id)
        }), 201

    new_friendship = Friendship(
        requester_id=current_user_id,
        addressee_id=target.id,
        status="pending"
    )
    db.session.add(new_friendship)
    db.session.flush()  # need friendship.id before creating the notification

    _create_notification(
        user_id=target.id,
        notif_type="friend_request",
        payload={
            "friendship_id": new_friendship.id,
            "from_user_id":  current_user_id,
            "from_email":    me.email,
        },
    )

    db.session.commit()

    return jsonify({
        "msg": "Friend request sent",
        "friendship": new_friendship.serialize(current_user_id=current_user_id)
    }), 201


# ---------- ACCEPT ----------
@api.route('/friends/requests/<int:request_id>/accept', methods=['PUT'])
@jwt_required()
def accept_friend_request(request_id):
    current_user_id = int(get_jwt_identity())
    friendship = db.session.get(Friendship, request_id)

    if not friendship:
        return jsonify({"msg": "Request not found"}), 404
    if friendship.addressee_id != current_user_id:
        return jsonify({"msg": "Only the addressee can accept this request"}), 403
    if friendship.status != "pending":
        return jsonify({"msg": f"Request is already {friendship.status}"}), 409

    friendship.status = "accepted"

    # this notification is now resolved -> drop it from the inbox
    _delete_friend_request_notifications(friendship.id)

    db.session.commit()

    return jsonify({
        "msg": "Friend request accepted",
        "friendship": friendship.serialize(current_user_id=current_user_id)
    }), 200


# ---------- REFUSE ----------
@api.route('/friends/requests/<int:request_id>/refuse', methods=['PUT'])
@jwt_required()
def refuse_friend_request(request_id):
    current_user_id = int(get_jwt_identity())
    friendship = db.session.get(Friendship, request_id)

    if not friendship:
        return jsonify({"msg": "Request not found"}), 404
    if friendship.addressee_id != current_user_id:
        return jsonify({"msg": "Only the addressee can refuse this request"}), 403
    if friendship.status != "pending":
        return jsonify({"msg": f"Request is already {friendship.status}"}), 409

    friendship.status = "refused"

    _delete_friend_request_notifications(friendship.id)

    db.session.commit()

    return jsonify({
        "msg": "Friend request refused",
        "friendship": friendship.serialize(current_user_id=current_user_id)
    }), 200


# ---------- CANCEL OUTGOING REQUEST ----------
@api.route('/friends/requests/<int:request_id>', methods=['DELETE'])
@jwt_required()
def cancel_friend_request(request_id):
    current_user_id = int(get_jwt_identity())
    friendship = db.session.get(Friendship, request_id)

    if not friendship:
        return jsonify({"msg": "Request not found"}), 404
    if friendship.requester_id != current_user_id:
        return jsonify({"msg": "Only the requester can cancel this request"}), 403
    if friendship.status != "pending":
        return jsonify({"msg": f"Request is already {friendship.status} and cannot be cancelled"}), 409

    _delete_friend_request_notifications(friendship.id)

    db.session.delete(friendship)
    db.session.commit()
    return jsonify({"msg": "Friend request cancelled"}), 200


# ---------- DELETE / UNFRIEND ----------
# Removes any accepted friendship between me and <user_id>.
@api.route('/friends/<int:user_id>', methods=['DELETE'])
@jwt_required()
def unfriend(user_id):
    current_user_id = int(get_jwt_identity())

    friendship = Friendship.query.filter(
        Friendship.status == "accepted"
    ).filter(
        ((Friendship.requester_id == current_user_id) & (Friendship.addressee_id == user_id)) |
        ((Friendship.requester_id == user_id) & (Friendship.addressee_id == current_user_id))
    ).first()

    if not friendship:
        return jsonify({"msg": "Friendship not found"}), 404

    db.session.delete(friendship)
    db.session.commit()
    return jsonify({"msg": "Friend removed"}), 200


# ---------- SEARCH USERS (helper for adding friends) ----------
# ?q=<string> matches against email, returns up to 20 users, excludes me.
@api.route('/friends/search', methods=['GET'])
@jwt_required()
def search_users():
    current_user_id = int(get_jwt_identity())
    q = (request.args.get("q") or "").strip()

    if len(q) < 2:
        return jsonify({"msg": "q must be at least 2 characters"}), 400

    users = (User.query
             .filter(User.id != current_user_id, User.email.ilike(f"%{q}%"))
             .limit(20)
             .all())

    # Augment with current friendship status so the UI can show the right button.
    results = []
    for u in users:
        pair = Friendship.query.filter(
            ((Friendship.requester_id == current_user_id) & (Friendship.addressee_id == u.id)) |
            ((Friendship.requester_id == u.id) & (Friendship.addressee_id == current_user_id))
        ).first()

        results.append({
            "id":     u.id,
            "email":  u.email,
            "status": pair.status if pair else "none",
            "direction": (
                "outgoing" if pair and pair.requester_id == current_user_id
                else "incoming" if pair and pair.addressee_id == current_user_id
                else None
            ),
            "friendship_id": pair.id if pair else None,
        })

    return jsonify(results), 200

# =========================================================
# PROFILE
# =========================================================

# ---------- GET MY PROFILE ----------
@api.route('/profile/me', methods=['GET'])
@jwt_required()
def get_my_profile():
    current_user_id = int(get_jwt_identity())
    user = db.session.get(User, current_user_id)
    if not user:
        return jsonify({"msg": "User not found"}), 404

    events_created_count = Event.query.filter(Event.creator_id == current_user_id).count()

    today = datetime.utcnow().date()

    all_events = Event.query.all()
    participated_all = [e for e in all_events if current_user_id in [p.id for p in e.participants]]

    def _is_past(e):
        try:
            return datetime.strptime(e.date, "%Y-%m-%d").date() <= today
        except (ValueError, TypeError):
            return False

    participated = [e for e in participated_all if _is_past(e)]
    events_participated_count = len(participated)

    window_start = today - timedelta(weeks=4)

    recent_count = 0
    for e in participated:
        try:
            event_date = datetime.strptime(e.date, "%Y-%m-%d").date()
            if window_start <= event_date <= today:
                recent_count += 1
        except (ValueError, TypeError):
            continue

    activity_avg_per_week = round(recent_count / 4.0, 2)

    if activity_avg_per_week < 2:
        activity_level = "Peu actif"
    elif activity_avg_per_week < 3:
        activity_level = "Actif"
    else:
        activity_level = "Très actif"

    activity_percent = min(100, int((activity_avg_per_week / 5.0) * 100))

    data = user.serialize()
    data["stats"] = {
        "events_created_count":      events_created_count,
        "events_participated_count": events_participated_count,
        "activity_avg_per_week":     activity_avg_per_week,
        "activity_level":            activity_level,
        "activity_percent":          activity_percent,
    }
    return jsonify(data), 200


# ---------- UPDATE MY PROFILE ----------
@api.route('/profile/me', methods=['PUT'])
@jwt_required()
def update_my_profile():
    current_user_id = int(get_jwt_identity())
    user = db.session.get(User, current_user_id)
    if not user:
        return jsonify({"msg": "User not found"}), 404

    body = request.get_json() or {}

    editable = [
        "username",
        "first_name",
        "last_name",
        "city",
        "bio",
        "profile_picture_url",
        "birthdate",
        "phone",
    ]

    new_username = body.get("username")
    if new_username and new_username != user.username:
        clash = User.query.filter(
            User.username == new_username,
            User.id != current_user_id
        ).first()
        if clash:
            return jsonify({"msg": "Username already taken"}), 409

    for field in editable:
        if field in body:
            value = body[field]
            setattr(user, field, value if value not in ("", None) else None)

    db.session.commit()

    return jsonify({"msg": "Profile updated", "user": user.serialize()}), 200


# ---------- GET ANOTHER USER'S PROFILE ----------
@api.route('/profile/<int:user_id>', methods=['GET'])
@jwt_required()
def get_user_profile(user_id):
    current_user_id = int(get_jwt_identity())
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({"msg": "User not found"}), 404

    friendship = None
    if user_id != current_user_id:
        friendship = Friendship.query.filter(
            ((Friendship.requester_id == current_user_id) & (Friendship.addressee_id == user_id)) |
            ((Friendship.requester_id == user_id) & (Friendship.addressee_id == current_user_id))
        ).first()

    is_self = (user_id == current_user_id)
    is_friend = friendship is not None and friendship.status == "accepted"

    data = {
        "id":                  user.id,
        "username":            user.username,
        "first_name":          user.first_name,
        "last_name":           user.last_name,
        "city":                user.city,
        "bio":                 user.bio,
        "profile_picture_url": user.profile_picture_url,
        "created_at":          user.created_at.isoformat() if user.created_at else None,
    }

    if is_self or is_friend:
        data["email"]     = user.email
        data["phone"]     = user.phone
        data["birthdate"] = user.birthdate

    if is_self:
        data["friendship_status"] = "self"
        data["friendship_direction"] = None
        data["friendship_id"] = None
    elif friendship:
        data["friendship_status"] = friendship.status
        data["friendship_direction"] = (
            "outgoing" if friendship.requester_id == current_user_id else "incoming"
        )
        data["friendship_id"] = friendship.id
    else:
        data["friendship_status"] = "none"
        data["friendship_direction"] = None
        data["friendship_id"] = None

    events_created_count = Event.query.filter(Event.creator_id == user_id).count()

    today = datetime.utcnow().date()

    all_events = Event.query.all()
    participated_all = [e for e in all_events if user_id in [p.id for p in e.participants]]

    def _is_past(e):
        try:
            return datetime.strptime(e.date, "%Y-%m-%d").date() <= today
        except (ValueError, TypeError):
            return False

    participated = [e for e in participated_all if _is_past(e)]
    events_participated_count = len(participated)

    window_start = today - timedelta(weeks=4)
    recent_count = 0
    for e in participated:
        try:
            event_date = datetime.strptime(e.date, "%Y-%m-%d").date()
            if window_start <= event_date <= today:
                recent_count += 1
        except (ValueError, TypeError):
            continue

    activity_avg_per_week = round(recent_count / 4.0, 2)
    if activity_avg_per_week < 2:
        activity_level = "Peu actif"
    elif activity_avg_per_week < 3:
        activity_level = "Actif"
    else:
        activity_level = "Très actif"
    activity_percent = min(100, int((activity_avg_per_week / 5.0) * 100))

    data["stats"] = {
        "events_created_count":      events_created_count,
        "events_participated_count": events_participated_count,
        "activity_avg_per_week":     activity_avg_per_week,
        "activity_level":            activity_level,
        "activity_percent":          activity_percent,
    }

    return jsonify(data), 200

# =========================================================
# CHAT
# =========================================================

# ---------- LIST MY CHAT ROOMS ----------
# Returns one row per event where I am a participant, each with
# its unread_count for the current user.
@api.route('/chat/rooms', methods=['GET'])
@jwt_required()
def list_chat_rooms():
    current_user_id = int(get_jwt_identity())

    all_rooms = ChatRoom.query.all()
    visible = [
        r for r in all_rooms
        if r.event and current_user_id in [p.id for p in r.event.participants]
    ]

    return jsonify([r.serialize(current_user_id=current_user_id) for r in visible]), 200


# ---------- TOTAL UNREAD CHAT MESSAGES (for the navbar badge) ----------
@api.route('/chat/unread-count', methods=['GET'])
@jwt_required()
def chat_unread_count():
    current_user_id = int(get_jwt_identity())

    all_rooms = ChatRoom.query.all()
    total = 0
    for r in all_rooms:
        if not r.event or current_user_id not in [p.id for p in r.event.participants]:
            continue
        membership = ChatRoomMembership.query.filter_by(
            room_id=r.id, user_id=current_user_id
        ).first()
        last_read_at = membership.last_read_at if membership else None
        for msg in r.messages:
            if msg.sender_id == current_user_id:
                continue
            if last_read_at is None or msg.created_at > last_read_at:
                total += 1

    return jsonify({"unread_count": total}), 200


# ---------- MARK A ROOM AS READ ----------
# Bumps last_read_at to "now" for the current user on that room.
# Idempotent — safe to spam from the UI on every open.
@api.route('/chat/rooms/<int:room_id>/read', methods=['PUT'])
@jwt_required()
def mark_room_read(room_id):
    current_user_id = int(get_jwt_identity())
    room = db.session.get(ChatRoom, room_id)
    if not room:
        return jsonify({"msg": "Room not found"}), 404

    # must be a participant of the underlying event
    if not room.event or current_user_id not in [p.id for p in room.event.participants]:
        return jsonify({"msg": "Not a participant of this room"}), 403

    membership = _get_or_create_membership(room_id, current_user_id)
    membership.last_read_at = datetime.utcnow()
    db.session.commit()

    return jsonify({
        "msg":          "Room marked as read",
        "room_id":      room_id,
        "last_read_at": membership.last_read_at.isoformat(),
    }), 200


# ---------- LIST MESSAGES OF AN EVENT ----------
@api.route('/events/<int:event_id>/chat/messages', methods=['GET'])
@jwt_required()
def list_event_messages(event_id):
    current_user_id = int(get_jwt_identity())
    event = db.session.get(Event, event_id)
    if not event:
        return jsonify({"msg": "Event not found"}), 404
    if current_user_id not in [p.id for p in event.participants]:
        return jsonify({"msg": "Not a participant of this event"}), 403

    room = ChatRoom.query.filter_by(event_id=event_id).first()
    if not room:
        # legacy event without a room: create one on the fly
        room = ChatRoom(event_id=event_id)
        db.session.add(room)
        db.session.commit()

    messages = ChatMessage.query.filter_by(room_id=room.id).order_by(ChatMessage.created_at).all()
    return jsonify({
        "room_id":  room.id,
        "messages": [m.serialize() for m in messages]
    }), 200


# ---------- SEND A MESSAGE ----------
@api.route('/events/<int:event_id>/chat/messages', methods=['POST'])
@jwt_required()
def post_event_message(event_id):
    current_user_id = int(get_jwt_identity())
    event = db.session.get(Event, event_id)
    if not event:
        return jsonify({"msg": "Event not found"}), 404
    if current_user_id not in [p.id for p in event.participants]:
        return jsonify({"msg": "Not a participant of this event"}), 403

    body = request.get_json() or {}
    text = (body.get("text") or "").strip()
    if not text:
        return jsonify({"msg": "text is required"}), 400

    room = ChatRoom.query.filter_by(event_id=event_id).first()
    if not room:
        room = ChatRoom(event_id=event_id)
        db.session.add(room)
        db.session.flush()

    msg = ChatMessage(room_id=room.id, sender_id=current_user_id, text=text)
    db.session.add(msg)

    # sender has obviously "read" their own message
    membership = _get_or_create_membership(room.id, current_user_id)
    membership.last_read_at = datetime.utcnow()

    db.session.commit()

    return jsonify({"msg": "Message sent", "message": msg.serialize()}), 201


# =========================================================
# NOTIFICATIONS
# =========================================================

# ---------- LIST MY NOTIFICATIONS ----------
# Optional query params:
#   ?only_unread=1  -> filter to unread only
@api.route('/notifications', methods=['GET'])
@jwt_required()
def list_notifications():
    current_user_id = int(get_jwt_identity())

    q = Notification.query.filter_by(user_id=current_user_id)
    if request.args.get("only_unread") in ("1", "true", "True"):
        q = q.filter_by(is_read=False)
    notifs = q.order_by(Notification.created_at.desc()).all()

    return jsonify([n.serialize() for n in notifs]), 200


# ---------- UNREAD COUNT (for the bell badge) ----------
@api.route('/notifications/unread-count', methods=['GET'])
@jwt_required()
def notifications_unread_count():
    current_user_id = int(get_jwt_identity())
    count = Notification.query.filter_by(
        user_id=current_user_id, is_read=False
    ).count()
    return jsonify({"unread_count": count}), 200


# ---------- MARK ONE AS READ ----------
@api.route('/notifications/<int:notif_id>/read', methods=['PUT'])
@jwt_required()
def mark_notification_read(notif_id):
    current_user_id = int(get_jwt_identity())
    n = db.session.get(Notification, notif_id)
    if not n:
        return jsonify({"msg": "Notification not found"}), 404
    if n.user_id != current_user_id:
        return jsonify({"msg": "Not your notification"}), 403

    n.is_read = True
    db.session.commit()
    return jsonify({"msg": "Notification marked as read", "notification": n.serialize()}), 200


# ---------- MARK ALL AS READ ----------
@api.route('/notifications/read-all', methods=['PUT'])
@jwt_required()
def mark_all_notifications_read():
    current_user_id = int(get_jwt_identity())
    notifs = Notification.query.filter_by(
        user_id=current_user_id, is_read=False
    ).all()
    for n in notifs:
        n.is_read = True
    db.session.commit()
    return jsonify({"msg": "All notifications marked as read", "count": len(notifs)}), 200


# ---------- DELETE A NOTIFICATION ----------
@api.route('/notifications/<int:notif_id>', methods=['DELETE'])
@jwt_required()
def delete_notification(notif_id):
    current_user_id = int(get_jwt_identity())
    n = db.session.get(Notification, notif_id)
    if not n:
        return jsonify({"msg": "Notification not found"}), 404
    if n.user_id != current_user_id:
        return jsonify({"msg": "Not your notification"}), 403

    db.session.delete(n)
    db.session.commit()
    return jsonify({"msg": "Notification deleted"}), 200
