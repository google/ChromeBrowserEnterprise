﻿// <auto-generated />
//
// To parse this JSON data, add NuGet 'Newtonsoft.Json' then do:
//
//    using cbcmSchema.ChromeBrowserPolicy;
//
//    var chromeMgmtPolicy = ChromeMgmtPolicy.FromJson(jsonString);

namespace cbcmSchema.ChromeBrowserPolicy
{
    using System;
    using System.Collections.Generic;

    using System.Globalization;
    using Newtonsoft.Json;
    using Newtonsoft.Json.Converters;

    public partial class ChromeMgmtPolicy
    {
        [JsonProperty("resolvedPolicies", NullValueHandling = NullValueHandling.Ignore)]
        public List<ResolvedPolicy> ResolvedPolicies { get; set; }

        [JsonProperty("nextPageToken", NullValueHandling = NullValueHandling.Ignore)]
        public string NextPageToken { get; set; }
    }

    public partial class ResolvedPolicy
    {
        [JsonProperty("targetKey", NullValueHandling = NullValueHandling.Ignore)]
        public Key TargetKey { get; set; }

        [JsonProperty("value", NullValueHandling = NullValueHandling.Ignore)]
        public ResolvedPolicyValue Value { get; set; }

        [JsonProperty("sourceKey", NullValueHandling = NullValueHandling.Ignore)]
        public Key SourceKey { get; set; }
    }

    public partial class Key
    {
        [JsonProperty("targetResource", NullValueHandling = NullValueHandling.Ignore)]
        public string TargetResource { get; set; }
    }

    public partial class ResolvedPolicyValue
    {
        [JsonProperty("policySchema", NullValueHandling = NullValueHandling.Ignore)]
        public string PolicySchema { get; set; }

        [JsonProperty("value", NullValueHandling = NullValueHandling.Ignore)]
        public object Value { get; set; }
    }



    public partial class ChromeMgmtPolicy
    {
        public static ChromeMgmtPolicy FromJson(string json) => JsonConvert.DeserializeObject<ChromeMgmtPolicy>(json, cbcmSchema.ChromeBrowserPolicy.Converter.Settings);
    }

    public static class Serialize
    {
        public static string ToJson(this ChromeMgmtPolicy self) => JsonConvert.SerializeObject(self, cbcmSchema.ChromeBrowserPolicy.Converter.Settings);
    }

    internal static class Converter
    {
        public static readonly JsonSerializerSettings Settings = new JsonSerializerSettings
        {
            MetadataPropertyHandling = MetadataPropertyHandling.Ignore,
            DateParseHandling = DateParseHandling.None,
            Converters =
            {
                new IsoDateTimeConverter { DateTimeStyles = DateTimeStyles.AssumeUniversal }
            },
        };
    }
}
