import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import { AuthGuard, CurrentUser } from './auth.guard.js';
import { AuthService, type AuthUser } from './auth.service.js';
import {
  SESSION_COOKIE,
  readSessionCookie,
  sessionCookieOptions,
} from './cookie.js';
import { SessionService } from './session.service.js';

export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password: string;
}

@Controller('tenants/:slug/auth')
export class AuthController {
  private readonly secureCookie: boolean;

  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    config: ConfigService,
  ) {
    // Set COOKIE_SECURE=true in production (HTTPS).
    this.secureCookie = config.get('COOKIE_SECURE') === 'true';
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Param('slug') slug: string,
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthUser> {
    const { token, user } = await this.auth.login(
      slug,
      dto.email,
      dto.password,
    );
    response.cookie(
      SESSION_COOKIE,
      token,
      sessionCookieOptions(this.secureCookie, this.sessions.ttlSeconds),
    );
    return user;
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const token = readSessionCookie(request);
    if (token) {
      await this.auth.logout(token);
    }
    response.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }
}
