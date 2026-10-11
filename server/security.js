import crypto from 'node:crypto';
import { promisify } from 'node:util';
import bcrypt from 'bcryptjs';

const scrypt = promisify(crypto.scrypt);
const ACCESS_SECONDS = 15 * 60;
export const SESSION_SECONDS = 30 * 24 * 60 * 60;
export const PASSWORD_MESSAGE = 'Use a password of 15–128 characters.';
let database;
export class AuthError extends Error {
    constructor(
        message = 'Authentication required',
        status = 401,
        code = 'AUTHENTICATION_REQUIRED',
    ) {
        super(message);
        this.status = status;
        this.code = code;
    }
}
export function configureSecurity({ pool }) {
    database = pool;
}
export function validateSecurityConfig(env = process.env) {
    for (const name of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'])
        if (typeof env[name] !== 'string' || Buffer.byteLength(env[name]) < 32)
            throw new Error(
                `${name} must contain at least 32 bytes of random secret material`,
            );
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET)
        throw new Error('JWT signing secrets must be different');
    if (!/^[0-9a-f]{64}$/i.test(env.TWO_FACTOR_ENCRYPTION_KEY || ''))
        throw new Error(
            'TWO_FACTOR_ENCRYPTION_KEY must be a 32-byte hex value',
        );
}
function signingKey(kind) {
    const key =
        process.env[
            kind === 'refresh' ? 'JWT_REFRESH_SECRET' : 'JWT_ACCESS_SECRET'
        ];
    if (!key || Buffer.byteLength(key) < 32)
        throw new Error('Authentication signing key is not configured');
    return key;
}
export function encrypt(value) {
    const key = Buffer.from(process.env.TWO_FACTOR_ENCRYPTION_KEY || '', 'hex');
    if (key.length !== 32)
        throw new Error('MFA encryption key is not configured');
    const iv = crypto.randomBytes(12),
        cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return `${iv.toString('hex')}.${cipher.getAuthTag().toString('hex')}.${body.toString('hex')}`;
}
export function decrypt(value) {
    const [iv, tag, body] = String(value).split('.');
    const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        Buffer.from(process.env.TWO_FACTOR_ENCRYPTION_KEY || '', 'hex'),
        Buffer.from(iv, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    return Buffer.concat([
        decipher.update(Buffer.from(body, 'hex')),
        decipher.final(),
    ]).toString('utf8');
}
export function signToken(payload, kind = 'access', seconds = ACCESS_SECONDS) {
    const now = Math.floor(Date.now() / 1000);
    const head = Buffer.from(
        JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
    ).toString('base64url');
    const body = Buffer.from(
        JSON.stringify({
            ...payload,
            iss: 'student-advisor',
            aud: 'student-advisor-web',
            iat: now,
            exp: now + seconds,
        }),
    ).toString('base64url');
    const signature = crypto
        .createHmac('sha256', signingKey(kind))
        .update(`${head}.${body}`)
        .digest('base64url');
    return `${head}.${body}.${signature}`;
}
export function verifyToken(token, kind = 'access', expectedType = kind) {
    try {
        if (typeof token !== 'string' || token.length > 4096) throw new Error();
        const parts = token.split('.');
        if (parts.length !== 3) throw new Error();
        const [head, body, signature] = parts;
        const header = JSON.parse(Buffer.from(head, 'base64url').toString());
        if (header.alg !== 'HS256' || header.typ !== 'JWT') throw new Error();
        const expected = crypto
            .createHmac('sha256', signingKey(kind))
            .update(`${head}.${body}`)
            .digest();
        const received = Buffer.from(signature, 'base64url');
        if (
            received.length !== expected.length ||
            !crypto.timingSafeEqual(received, expected)
        )
            throw new Error();
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString()),
            now = Math.floor(Date.now() / 1000);
        if (
            !Number.isInteger(payload.exp) ||
            payload.exp <= now ||
            !Number.isInteger(payload.iat) ||
            payload.iat > now + 30 ||
            payload.type !== expectedType ||
            payload.iss !== 'student-advisor' ||
            payload.aud !== 'student-advisor-web' ||
            typeof payload.sub !== 'string'
        )
            throw new Error();
        return payload;
    } catch {
        throw new AuthError('Invalid or expired authentication token');
    }
}
export const hashToken = value =>
    crypto.createHash('sha256').update(String(value)).digest('hex');
export const verifyAccess = token => verifyToken(token, 'access', 'access');
export const verifyRefresh = token => verifyToken(token, 'refresh', 'refresh');
export function validatePassword(password) {
    return (
        typeof password === 'string' &&
        [...password].length >= 15 &&
        [...password].length <= 128 &&
        Buffer.byteLength(password) <= 1024
    );
}
export const validPassword = validatePassword;
export async function hashPassword(password) {
    if (!validatePassword(password))
        throw new AuthError(PASSWORD_MESSAGE, 400, 'INVALID_PASSWORD');
    const salt = crypto.randomBytes(16),
        key = await scrypt(password, salt, 64, {
            N: 32768,
            r: 8,
            p: 3,
            maxmem: 64 * 1024 * 1024,
        });
    return `scrypt$32768$8$3$${salt.toString('hex')}$${key.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
    if (typeof password !== 'string' || Buffer.byteLength(password) > 1024)
        return false;
    if (stored?.startsWith('$2')) return bcrypt.compare(password, stored);
    const parts = String(stored || '').split('$');
    const valid =
        parts.length === 6 &&
        parts[0] === 'scrypt' &&
        parts[1] === '32768' &&
        parts[2] === '8' &&
        parts[3] === '3' &&
        /^[0-9a-f]{32}$/.test(parts[4]) &&
        /^[0-9a-f]{128}$/.test(parts[5]);
    // Spend the same work for absent users so the login response is not a cheap account oracle.
    const salt = valid ? Buffer.from(parts[4], 'hex') : Buffer.alloc(16);
    const actual = await scrypt(password, salt, 64, {
        N: 32768,
        r: 8,
        p: 3,
        maxmem: 64 * 1024 * 1024,
    });
    return (
        valid && crypto.timingSafeEqual(actual, Buffer.from(parts[5], 'hex'))
    );
}
export function cookieOptions() {
    return {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/api/auth',
    };
}
export function clearAuthCookies(res) {
    res.clearCookie('refresh_token', cookieOptions());
    res.clearCookie('auth_pending', cookieOptions());
    res.clearCookie('oauth_state', cookieOptions());
}
export function publicUser(user) {
    let permissions = user.permissions || {};
    if (typeof permissions === 'string') {
        try {
            permissions = JSON.parse(permissions);
        } catch {
            permissions = {};
        }
    }
    return {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role || 'student',
        permissions,
        twoFactorEnabled: Boolean(user.two_factor_enabled),
        emailVerified: Boolean(user.email_verified),
    };
}
export async function issueSession(
    res,
    user,
    {
        connection = database,
        sessionId,
        authenticatedAt = new Date(),
        expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000),
    } = {},
) {
    if (
        !user.email_verified ||
        (['admin', 'advisor', 'moderator'].includes(user.role) &&
            !user.two_factor_enabled)
    )
        throw new AuthError(
            'Complete account verification before signing in',
            403,
        );
    const sid = sessionId || crypto.randomUUID(),
        tokenId = crypto.randomUUID();
    if (!sessionId)
        await connection.execute(
            'INSERT INTO auth_sessions (id, user_id, authenticated_at, expires_at) VALUES (?, ?, ?, ?)',
            [sid, user.id, authenticatedAt, expiresAt],
        );
    const remaining = Math.max(
        1,
        Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000),
    );
    const refresh = signToken(
        { sub: user.id, sid, jti: tokenId, type: 'refresh' },
        'refresh',
        remaining,
    );
    await connection.execute(
        'INSERT INTO refresh_tokens (id, user_id, session_id, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)',
        [tokenId, user.id, sid, hashToken(refresh), expiresAt],
    );
    res.cookie('refresh_token', refresh, {
        ...cookieOptions(),
        maxAge: remaining * 1000,
    });
    return signToken({
        sub: user.id,
        sid,
        version: Number(user.auth_version || 0),
        type: 'access',
    });
}
export async function authenticateRequest(req) {
    const header = req.get('authorization') || '';
    if (!header.startsWith('Bearer ')) throw new AuthError();
    const payload = verifyAccess(header.slice(7));
    if (typeof payload.sid !== 'string' || !Number.isInteger(payload.version))
        throw new AuthError();
    const [rows] = await database.execute(
        'SELECT u.*, s.authenticated_at FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.user_id = ? AND s.revoked_at IS NULL AND s.expires_at > UTC_TIMESTAMP() AND u.auth_version = ? AND u.email_verified = TRUE LIMIT 1',
        [payload.sid, payload.sub, payload.version],
    );
    const user = rows[0];
    if (
        !user ||
        (['admin', 'advisor', 'moderator'].includes(user.role) &&
            !user.two_factor_enabled)
    )
        throw new AuthError('Your session has ended. Please sign in again.');
    req.user = {
        ...payload,
        email: user.email,
        role: user.role,
        authenticatedAt: user.authenticated_at,
    };
    req.authUser = user;
    return user;
}
export async function authRequired(req, res, next) {
    try {
        await authenticateRequest(req);
        next();
    } catch (error) {
        if (error instanceof AuthError)
            res.status(error.status).json({
                error: error.message,
                code: error.code,
            });
        else next(error);
    }
}
function staffAccess(check, message) {
    return (req, res, next) =>
        authRequired(req, res, () => {
            const user = {
                ...req.authUser,
                permissions: publicUser(req.authUser).permissions,
            };
            if (!check(user)) return res.status(403).json({ error: message });
            req.staffUser = user;
            next();
        });
}
export const adminRequired = staffAccess(
    user => user.role === 'admin',
    'Admin access required',
);
export const staffRequired = (permission = 'viewOnly') =>
    staffAccess(
        user =>
            user.role === 'admin' ||
            (user.role === 'moderator' &&
                user.permissions?.[permission] === true),
        'Staff access has not been granted',
    );
export const advisorRequired = (permission = 'advisorDashboard') =>
    staffAccess(
        user =>
            user.role === 'advisor' ||
            (user.role === 'moderator' &&
                user.permissions?.advisorDashboard === true &&
                user.permissions?.[permission] === true),
        'Adviser access has not been granted',
    );
export async function revokeUserSessions(userId, connection = database) {
    await connection.execute(
        'UPDATE users SET auth_version = auth_version + 1 WHERE id = ?',
        [userId],
    );
    await connection.execute(
        'UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP()) WHERE user_id = ?',
        [userId],
    );
    await connection.execute(
        'UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP()) WHERE user_id = ?',
        [userId],
    );
    await connection.execute(
        'UPDATE auth_challenges SET consumed_at = COALESCE(consumed_at, UTC_TIMESTAMP()) WHERE user_id = ?',
        [userId],
    );
}
