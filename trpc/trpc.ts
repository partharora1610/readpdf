import { currentUser } from "@clerk/nextjs/server";
import { initTRPC } from "@trpc/server";

const t = initTRPC.create({});
const middleware = t.middleware;

const isAuth = middleware(async (opts) => {
  const user = await currentUser();

  if (!user) {
    throw new Error("Unauthorized");
  }

  return opts.next({
    ctx: {
      userId: user.id,
      user,
    },
  });
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const privateProcedure = t.procedure.use(isAuth);
