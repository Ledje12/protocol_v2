import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl =
      Deno.env.get("SUPABASE_URL");

    const supabaseAnonKey =
      Deno.env.get("SUPABASE_ANON_KEY");

    const serviceRoleKey =
      Deno.env.get(
        "SUPABASE_SERVICE_ROLE_KEY"
      );

    if (
      !supabaseUrl ||
      !supabaseAnonKey ||
      !serviceRoleKey
    ) {
      throw new Error(
        "Missing Supabase environment variables"
      );
    }

    const authorization =
      req.headers.get("Authorization");

    if (!authorization) {
      return new Response(
        JSON.stringify({
          error: "Authentication required",
        }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            "Content-Type":
              "application/json",
          },
        }
      );
    }

    /*
     * Client utilisateur.
     *
     * C'est lui qui appelle la RPC :
     * auth.uid() correspond donc bien au compte
     * qui demande SA propre suppression.
     */
    const userClient = createClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        global: {
          headers: {
            Authorization: authorization,
          },
        },
        auth: {
          persistSession: false,
        },
      }
    );

    /*
     * Vérification explicite du JWT.
     */
    const {
      data: userData,
      error: userError,
    } = await userClient.auth.getUser();

    if (
      userError ||
      !userData?.user?.id
    ) {
      return new Response(
        JSON.stringify({
          error: "Invalid user session",
        }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            "Content-Type":
              "application/json",
          },
        }
      );
    }

    const userId =
      userData.user.id;

    /*
     * 1. PURGE MÉTIER
     */
    const {
      data: purgeResult,
      error: purgeError,
    } = await userClient.rpc(
      "delete_protocol_account_data"
    );

    if (purgeError) {
      console.error(
        "ACCOUNT PURGE ERROR:",
        purgeError
      );

      return new Response(
        JSON.stringify({
          error:
            "Account data cleanup failed",
          details:
            purgeError.message,
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type":
              "application/json",
          },
        }
      );
    }

    /*
     * La RPC refuse implicitement de donner
     * son feu vert si des références subsistent.
     */
    if (
      !purgeResult?.ok ||
      Number(
        purgeResult
          ?.residual_user_references ??
          0
      ) !== 0
    ) {
      console.error(
        "RESIDUAL USER REFERENCES:",
        purgeResult
      );

      return new Response(
        JSON.stringify({
          error:
            "Residual account references remain",
          purge: purgeResult,
        }),
        {
          status: 409,
          headers: {
            ...corsHeaders,
            "Content-Type":
              "application/json",
          },
        }
      );
    }

    /*
     * 2. CLIENT ADMIN
     *
     * La service role ne quitte jamais
     * l'Edge Function.
     */
    const adminClient =
      createClient(
        supabaseUrl,
        serviceRoleKey,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        }
      );

    /*
     * 3. SUPPRESSION AUTH DÉFINITIVE
     */
    const {
      error: deleteUserError,
    } =
      await adminClient.auth.admin.deleteUser(
        userId,
        false
      );

    if (deleteUserError) {
      console.error(
        "AUTH DELETE ERROR:",
        deleteUserError
      );

      return new Response(
        JSON.stringify({
          error:
            "Business data was cleaned but Auth deletion failed",
          details:
            deleteUserError.message,
          purge:
            purgeResult,
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type":
              "application/json",
          },
        }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        deleted_user_id:
          userId,
        purge:
          purgeResult,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type":
            "application/json",
        },
      }
    );
  } catch (error) {
    console.error(
      "DELETE ACCOUNT ERROR:",
      error
    );

    return new Response(
      JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : "Unknown error",
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type":
            "application/json",
        },
      }
    );
  }
});