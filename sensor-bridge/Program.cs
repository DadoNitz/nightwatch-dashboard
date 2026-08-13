using System.Collections;
using System.Reflection;
using System.Runtime.Loader;
using System.Text.Json;

const string fanControlDir = @"C:\Program Files (x86)\FanControl";
AssemblyLoadContext.Default.Resolving += (_, name) =>
{
    var dependency = Path.Combine(fanControlDir, name.Name + ".dll");
    return File.Exists(dependency) ? AssemblyLoadContext.Default.LoadFromAssemblyPath(dependency) : null;
};

if (args.Length > 1 && args[0] == "--inspect")
{
    var inspected = AssemblyLoadContext.Default.LoadFromAssemblyPath(Path.Combine(fanControlDir, args[1]));
    foreach (var type in inspected.GetTypes().Where(t => t.IsPublic || t.IsNestedPublic))
    {
        Console.WriteLine($"TYPE {type.FullName}");
        foreach (var member in type.GetMembers(BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly))
            Console.WriteLine($"  {member.MemberType} {member}");
    }
    return;
}

try
{
    var assembly = AssemblyLoadContext.Default.LoadFromAssemblyPath(Path.Combine(fanControlDir, "FanControl.IPC.dll"));
    var factoryType = assembly.GetType("FanControl.IPC.IPCFactory", true)!;
    var getClient = factoryType.GetMethod("GetSensorClient")!;
    var factory = getClient.IsStatic ? null : Activator.CreateInstance(factoryType, nonPublic: true);
    var client = getClient.Invoke(factory, null)!;
    var request = Activator.CreateInstance(assembly.GetType("GetAllSensorsRequest", true)!)!;
    var getAll = client.GetType().GetMethods().First(m => m.Name == "GetAllSensors" && m.GetParameters().Length == 4);
    var reply = getAll.Invoke(client, new object?[] { request, null, null, CancellationToken.None })!;
    var sensors = new List<object>();
    foreach (var sensor in (IEnumerable)reply.GetType().GetProperty("Sensors")!.GetValue(reply)!)
    {
        if (sensor is null) continue;
        var type = sensor.GetType();
        var hasValue = (bool)(type.GetProperty("HasValue")?.GetValue(sensor) ?? false);
        if (!hasValue) continue;
        sensors.Add(new
        {
            id = type.GetProperty("Identifier")?.GetValue(sensor)?.ToString() ?? "",
            hardware = type.GetProperty("Origin")?.GetValue(sensor)?.ToString() ?? "FanControl",
            hardwareType = "FanControl",
            type = type.GetProperty("Type")?.GetValue(sensor)?.ToString() ?? "Unknown",
            name = type.GetProperty("Name")?.GetValue(sensor)?.ToString() ?? "Sensor",
            value = Math.Round(Convert.ToDouble(type.GetProperty("Value")?.GetValue(sensor)), 1)
        });
    }
    Console.WriteLine(JsonSerializer.Serialize(new { ok = true, at = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), sensors }));
}
catch (Exception ex)
{
    var error = ex.InnerException?.Message ?? ex.Message;
    Console.WriteLine(JsonSerializer.Serialize(new { ok = false, error, sensors = Array.Empty<object>() }));
    Environment.ExitCode = 1;
}
