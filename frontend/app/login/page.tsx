"use client";

import { Suspense, useState } from "react";
import { login } from "@/lib/api";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Lock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Footer } from "@/components/footer";
import { APP_NAME, APP_TAGLINE } from "@/lib/ui-text";
import { getSafeRedirectPath } from "@/lib/utils/common";

type LoginFormValues = {
  password: string;
};

function LoginContent() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  const form = useForm<LoginFormValues>({
    defaultValues: {
      password: "",
    },
  });

  const onSubmit = async (values: LoginFormValues) => {
    if (loading) return;
    setLoading(true);
    try {
      const success = await login(values.password);
      if (!success) {
        throw new Error("登录失败，请检查密码");
      }
      toast.success("登录成功");
      const redirectUrl = getSafeRedirectPath(
        searchParams.get("redirect"),
        window.location.origin
      );
      router.push(redirectUrl);
    } catch (err: any) {
      console.error("Login failed:", err);
      toast.error(err.message || "登录失败，请检查密码");
    } finally {
      setLoading(false);
    }
  };
  const submitLogin = form.handleSubmit(onSubmit);

  return (
    <div className="flex-1 flex flex-col items-center justify-center w-full max-w-[360px] z-10 animate-in fade-in zoom-in-95 duration-700">
      <div className="w-full p-8 rounded-3xl bg-card/60 backdrop-blur-2xl border border-glass-border shadow-2xl shadow-black/10 flex flex-col items-center">
        <div className="flex flex-col items-center mb-8">
          <div className="relative w-20 h-20 rounded-3xl bg-linear-to-tr from-primary via-emerald-400 to-teal-300 flex items-center justify-center text-4xl shadow-xl shadow-primary/30 mb-5 select-none transition-transform hover:scale-105 duration-300">
            <span>🦦</span>
          </div>
          <h1 className="text-3xl font-extrabold text-foreground tracking-tight">
            {APP_NAME}
          </h1>
          <p className="text-foreground/50 text-xs font-semibold mt-1.5 tracking-widest uppercase">
            {APP_TAGLINE}
          </p>
        </div>

        <Form {...form}>
          <form onSubmit={submitLogin} className="w-full space-y-4">
            <FormField
              control={form.control}
              name="password"
              rules={{ required: "请输入密码" }}
              render={({ field }) => (
                <FormItem className="space-y-0">
                  <FormControl>
                    <div className="relative group">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground/40 group-focus-within:text-primary transition-colors" />
                      <Input
                        type="password"
                        placeholder="请输入访问密码"
                        className="h-11 pl-10.5 bg-secondary/40 border-glass-border backdrop-blur-md text-foreground placeholder:text-foreground/40 focus-visible:ring-2 focus-visible:ring-primary/30 transition-all rounded-xl text-sm"
                        disabled={loading}
                        onKeyDown={(event) => {
                          if (
                            event.key !== "Enter" ||
                            event.nativeEvent.isComposing ||
                            loading
                          ) {
                            return;
                          }
                          event.preventDefault();
                          submitLogin();
                        }}
                        {...field}
                      />
                    </div>
                  </FormControl>
                  <FormMessage className="text-center mt-2 text-xs" />
                </FormItem>
              )}
            />
            <Button
              type="submit"
              className="w-full h-11 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-all font-semibold text-sm shadow-lg shadow-primary/25 active:scale-[0.99]"
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "进入系统"
              )}
            </Button>
          </form>
        </Form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="relative min-h-screen flex flex-col items-center justify-between p-6 bg-linear-to-br from-gradient-from via-gradient-via to-gradient-to overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 rounded-full blur-[120px] animate-pulse" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-accent/20 rounded-full blur-[120px] animate-pulse delay-700" />

      <Suspense
        fallback={
          <div className="flex-1 flex flex-col items-center justify-center w-full max-w-[320px] z-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        }
      >
        <LoginContent />
      </Suspense>

      <div className="relative z-10 opacity-60 hover:opacity-100 transition-opacity">
        <Footer />
      </div>
    </div>
  );
}
