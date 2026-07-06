export type StaffPermissionUser = {
    id?: string | null;
    name?: string | null;
    role?: string | null;
};

const YANG_HEE_CHEOL_ID = 'cmojpskkh0000994c99z7ro6d';
const YANG_HEE_CHEOL_NAME = '\uC591\uD76C\uCCA0';
const FULL_ACCESS_ROLES = new Set(['EXECUTIVE', 'ADMIN']);

export function normalizeStaffName(name?: string | null) {
    return (name ?? '').replace(/\s/g, '');
}

export function isYangHeeCheol(user?: StaffPermissionUser | null) {
    if (!user) return false;
    return user.id === YANG_HEE_CHEOL_ID || normalizeStaffName(user.name) === YANG_HEE_CHEOL_NAME;
}

export function canViewAllStaffData(user?: StaffPermissionUser | null) {
    if (!user) return false;
    return isYangHeeCheol(user) || FULL_ACCESS_ROLES.has(user.role ?? '');
}

export function canEditCustomerLedger(user?: StaffPermissionUser | null) {
    return isYangHeeCheol(user);
}
