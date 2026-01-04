/**
 * Daily Follow-up Pattern Analysis Edge Function
 *
 * Runs daily to analyze:
 * - Rejected follow-ups with feedback
 * - Approval rates
 * - Patterns in successful vs rejected messages
 * - Suggest prompt improvements
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface AnalysisRequest {
  days_back?: number; // Default: 7
  min_sample_size?: number; // Default: 50
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { days_back = 7, min_sample_size = 50 }: AnalysisRequest = await req.json().catch(() => ({}));

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days_back);

    console.log(`[Pattern Analysis] Analyzing from ${startDate.toISOString()} to ${endDate.toISOString()}`);

    // 1. Get all training data from the period
    const { data: trainingData, error: trainingError } = await supabase
      .from('followup_training_data')
      .select('*')
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString())
      .eq('used_in_training', false);

    if (trainingError) {
      throw new Error(`Failed to fetch training data: ${trainingError.message}`);
    }

    // 2. Get approval stats from the same period
    const { data: approvals, error: approvalsError } = await supabase
      .from('followup_approvals')
      .select('id, status, rejection_reason, alternative_message, created_at')
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString());

    if (approvalsError) {
      throw new Error(`Failed to fetch approvals: ${approvalsError.message}`);
    }

    // 3. Calculate metrics
    const totalApprovals = approvals?.length || 0;
    const approved = approvals?.filter(a => a.status === 'approved').length || 0;
    const rejected = approvals?.filter(a => a.status === 'rejected').length || 0;
    const approvalRate = totalApprovals > 0 ? (approved / totalApprovals * 100).toFixed(1) : 0;

    console.log(`[Pattern Analysis] Total: ${totalApprovals}, Approved: ${approved}, Rejected: ${rejected}`);

    // 4. Analyze rejection reasons
    const rejectionReasons: Record<string, number> = {};
    const rejectedApprovals = approvals?.filter(a => a.status === 'rejected' && a.rejection_reason) || [];

    for (const approval of rejectedApprovals) {
      const reason = approval.rejection_reason?.toLowerCase() || 'unknown';

      // Categorize reasons
      if (reason.includes('formell') || reason.includes('förmlich')) {
        rejectionReasons['zu_formell'] = (rejectionReasons['zu_formell'] || 0) + 1;
      } else if (reason.includes('informell') || reason.includes('locker')) {
        rejectionReasons['zu_informell'] = (rejectionReasons['zu_informell'] || 0) + 1;
      } else if (reason.includes('lang') || reason.includes('ausführlich')) {
        rejectionReasons['zu_lang'] = (rejectionReasons['zu_lang'] || 0) + 1;
      } else if (reason.includes('kurz') || reason.includes('knapp')) {
        rejectionReasons['zu_kurz'] = (rejectionReasons['zu_kurz'] || 0) + 1;
      } else if (reason.includes('kontext') || reason.includes('passt nicht')) {
        rejectionReasons['falscher_kontext'] = (rejectionReasons['falscher_kontext'] || 0) + 1;
      } else if (reason.includes('ton') || reason.includes('stil')) {
        rejectionReasons['falscher_ton'] = (rejectionReasons['falscher_ton'] || 0) + 1;
      } else if (reason.includes('abgesagt') || reason.includes('kein interesse')) {
        rejectionReasons['lead_nicht_interessiert'] = (rejectionReasons['lead_nicht_interessiert'] || 0) + 1;
      } else {
        rejectionReasons['sonstige'] = (rejectionReasons['sonstige'] || 0) + 1;
      }
    }

    // 5. Identify patterns
    const patterns: Array<{
      pattern: string;
      confidence: number;
      sample_size: number;
      suggestion?: string;
    }> = [];

    // Check for significant patterns
    const significantThreshold = 0.15; // 15% of rejections

    for (const [reason, count] of Object.entries(rejectionReasons)) {
      const percentage = rejected > 0 ? count / rejected : 0;
      if (percentage >= significantThreshold) {
        let suggestion = '';
        switch (reason) {
          case 'zu_formell':
            suggestion = 'Lockerer, freundlicherer Ton empfohlen';
            break;
          case 'zu_informell':
            suggestion = 'Professionellerer Ton empfohlen';
            break;
          case 'zu_lang':
            suggestion = 'Kürzere, prägnantere Nachrichten empfohlen';
            break;
          case 'zu_kurz':
            suggestion = 'Mehr Kontext und Details hinzufügen';
            break;
          case 'falscher_kontext':
            suggestion = 'Bessere Kontextanalyse der Konversation';
            break;
          case 'falscher_ton':
            suggestion = 'Tonalität an Lead-Kommunikationsstil anpassen';
            break;
          case 'lead_nicht_interessiert':
            suggestion = 'Bessere Erkennung von desinteressierten Leads';
            break;
        }

        patterns.push({
          pattern: reason.replace(/_/g, ' '),
          confidence: parseFloat((percentage * 100).toFixed(1)),
          sample_size: count,
          suggestion
        });
      }
    }

    // 6. Get active prompt version for comparison
    const { data: activePrompt } = await supabase
      .from('followup_prompt_versions')
      .select('*')
      .eq('is_active', true)
      .eq('category', 'standard_followup')
      .single();

    // 7. Generate suggested prompt changes based on patterns
    const suggestedChanges: string[] = [];
    for (const pattern of patterns) {
      if (pattern.suggestion) {
        suggestedChanges.push(`- ${pattern.pattern}: ${pattern.suggestion} (${pattern.confidence}% der Ablehnungen)`);
      }
    }

    // 8. Store analysis results
    const { data: analysisResult, error: analysisError } = await supabase
      .from('followup_pattern_analysis')
      .insert({
        analysis_date: endDate.toISOString().split('T')[0],
        data_start_date: startDate.toISOString().split('T')[0],
        data_end_date: endDate.toISOString().split('T')[0],
        total_followups_analyzed: totalApprovals,
        approved_count: approved,
        rejected_count: rejected,
        patterns: patterns,
        suggested_changes: suggestedChanges,
        review_decision: 'pending'
      })
      .select()
      .single();

    if (analysisError) {
      // Might be duplicate for today, update instead
      if (analysisError.code === '23505') {
        const { data: updatedResult } = await supabase
          .from('followup_pattern_analysis')
          .update({
            total_followups_analyzed: totalApprovals,
            approved_count: approved,
            rejected_count: rejected,
            patterns: patterns,
            suggested_changes: suggestedChanges
          })
          .eq('analysis_date', endDate.toISOString().split('T')[0])
          .select()
          .single();

        console.log('[Pattern Analysis] Updated existing analysis for today');
      } else {
        console.error('[Pattern Analysis] Failed to store analysis:', analysisError);
      }
    }

    // 9. Mark training data as used
    if (trainingData && trainingData.length > 0) {
      const ids = trainingData.map(t => t.id);
      await supabase
        .from('followup_training_data')
        .update({
          used_in_training: true,
          used_in_training_at: new Date().toISOString()
        })
        .in('id', ids);

      console.log(`[Pattern Analysis] Marked ${ids.length} training entries as used`);
    }

    // 10. Update prompt performance metrics
    if (activePrompt) {
      await supabase
        .from('followup_prompt_performance')
        .upsert({
          prompt_version_id: activePrompt.id,
          period_date: endDate.toISOString().split('T')[0],
          total_sent: totalApprovals,
          total_approved: approved,
          total_rejected: rejected,
          approval_rate: approvalRate
        }, {
          onConflict: 'prompt_version_id,period_date'
        });
    }

    const result = {
      success: true,
      analysis_date: endDate.toISOString().split('T')[0],
      metrics: {
        total_analyzed: totalApprovals,
        approved,
        rejected,
        approval_rate: `${approvalRate}%`
      },
      patterns,
      suggested_changes: suggestedChanges,
      training_data_processed: trainingData?.length || 0
    };

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error('[Pattern Analysis] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
