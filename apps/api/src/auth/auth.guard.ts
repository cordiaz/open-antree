import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService, type AuthUser, type Role } from './auth.service.js';
import { readSessionCookie } from './cookie.js';

const ROLES_KEY = 'roles';

// Roles allowed on a route; without it, any logged-in staff member of the tenant.
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

type AuthedRequest = Request & { user?: AuthUser };

export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<AuthedRequest>().user,
);

// Requires a valid session cookie for the tenant named in the :slug route
// parameter, so a session from one tenant can't be used on another.
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const token = readSessionCookie(request);
    const user = token ? await this.auth.userForToken(token) : null;
    if (!user) {
      throw new UnauthorizedException('Silakan login terlebih dahulu');
    }

    if (user.tenant.slug !== request.params.slug) {
      throw new ForbiddenException('Akun ini bukan milik tenant tersebut');
    }

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (roles && !roles.includes(user.role)) {
      throw new ForbiddenException('Akses tidak diizinkan untuk peran ini');
    }

    request.user = user;
    return true;
  }
}
