from dataclasses import dataclass
from typing import Optional, List


@dataclass
class MemberKey:
    id: Optional[str] = None


@dataclass
class PreferredMemberKey:
    id: Optional[str] = None
    device_id: Optional[str] = None
    name: Optional[str] = None
    is_member: Optional[bool] = False


@dataclass
class Role:
    name: Optional[str] = None


@dataclass
class Membership:
    name: Optional[str] = None
    member_key: Optional[MemberKey] = None
    role: Optional[Role] = None
    preferred_member_key: Optional[PreferredMemberKey] = None


@dataclass
class Cloudidentitymembership:
    memberships: Optional[List[Membership]] = None
