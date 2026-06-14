export type UserRole = 'admin' | 'leader' | 'member';

export interface AuthUser {
  id: number | string;
  name: string;
  email: string;
  role: UserRole;
}

export interface ManagedUser extends AuthUser {
  isActive: boolean;
  createdAt: string;
}
